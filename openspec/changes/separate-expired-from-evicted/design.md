## Context

The bundled persistence implementations currently treat HTTP expiration as a
deletion trigger:

- **Memory** (`src/cache-persistence-memory.ts:204, 214-225`):
  `_scheduleRemoval` schedules a `setTimeout` that calls `_dbDel` when the
  response expires.
- **Deno KV** (`src/cache-persistence-deno-kv.ts:226`): `setBlob` is called with
  `{ expireIn }` derived from `_expiresIn()`, letting Deno KV's native TTL
  remove the value.
- **Redis** (`src/cache-persistence-redis.ts:308, 314-316`): `PEXPIRE` is issued
  with the same TTL, letting Redis remove the keys.

The value passed to all three primitives is computed by
`CachePersistenceBase._expiresIn(response)`
(`src/cache-persistence-base.ts:91-133`), which:

1. Parses `Cache-Control: s-maxage` / `max-age` (with `s-maxage` taking
   priority).
2. Falls back to `Expires`.
3. Falls back to a default of `2_592_000_000` ms (30 days).
4. **Caps the result at `_maxPersistenceTtlMs`** (also `2_592_000_000` ms),
   which is a `protected` field hardcoded on the base class at
   `src/cache-persistence-base.ts:16-17`.

So `_maxPersistenceTtlMs` is already a **universal ceiling** on what every
bundled implementation passes to its eviction primitive — it caps `max-age`
overshoots, caps `Expires` overshoots, and supplies the default when neither is
present. It just isn't visible to callers. The earlier draft of this design
mistakenly framed `_maxPersistenceTtlMs` as a Deno-KV-specific concern; in fact
every backend uses it.

In all three implementations, `_pairToPlain` also writes
`PlainReqResMeta.expires` (the absolute epoch when the response expires per HTTP
semantics) into the stored payload (`src/cache-persistence-base.ts:198-219`). So
the metadata to reason about freshness is already there — it's just being
shadowed by storage-layer deletion that beats anyone to the punch.

Additionally, `get()` in each implementation contains a defensive
`if (this._hasExpired(plainReqRes)) { continue; }` (Memory:100, Deno KV:115,
Redis:148). This handles the race between "entry expired" and "scheduled delete
actually fired", and covers Redis's keyspace where two keys per entry exist and
one might have been cleaned up before the other.

The `Cache` layer (`src/cache.ts`) is freshness-agnostic: it iterates whatever
`_persistence.get()` yields and trusts it. There is no current notion of
staleness above the persistence boundary.

The library is published with a public `CachePersistenceLike` interface and
three bundled implementations. Real-world consumers may rely on the current
"expired = gone" semantics. Silent behavior change is unacceptable.

**Framing.** The current default (`'evict'`) is _the_ deviation from the W3C
Service Worker spec, which says cache entries do not expire. The new `'retain'`
mode is _more_ spec-compliant, not less: it makes entries persist (bounded by
`maxPersistenceTtlMs`) and lets standard `Cache.match()` return whatever the
persistence holds. Under that framing, the design goal is "let users pick where
on the spec-versus-pragmatism axis they want to be, with an explicit
storage-lifetime ceiling on top".

## Goals / Non-Goals

**Goals:**

- Decouple "track expiration" (storage concern, already implemented) from "evict
  on expiration" (policy concern, currently entangled with storage).
- Offer `'retain'` as a path to genuine W3C `Cache` API compliance —
  `Cache.match()` returns whatever matches, freshness is application concern.
- Promote today's hidden `_maxPersistenceTtlMs` field to a documented public
  option `maxPersistenceTtlMs`, framed precisely as a universal upper bound on
  entry storage lifetime applied in every retention mode — never as a freshness
  knob.
- Together, `staleRetention` and `maxPersistenceTtlMs` form a two-axis design
  that covers all currently-anticipated production caching configurations,
  including pure absolute-TTL semantics (formerly deferred to a hypothetical
  future `'ttl'` mode).
- Make stale entries observable to application code without forcing it to parse
  `Cache-Control`/`Expires`/`Date`/`Age`: a single `x-cachestorage-stale: 1`
  header is set on materialized Responses when the entry is past its HTTP
  expiration. Convenience, not a contract for any new method.
- Preserve current default behavior bit-for-bit — `staleRetention: 'evict'` +
  `maxPersistenceTtlMs: 2_592_000_000` matches today's hardcoded behavior
  exactly.
- Keep the `CachePersistenceLike` and `CacheLike` _interface signatures_
  unchanged. Only construction-time options grow.

**Non-Goals:**

- Adding any non-standard method to `Cache` (no `matchIncludingStale`, no new
  options on `match`/`matchAll`/`keys`). The W3C interface is left exactly as
  specified, under both retention modes.
- Implementing `stale-while-revalidate`/`stale-if-error` directives, automatic
  revalidation against the origin, LRU eviction, or `maxSize`. This change
  _unblocks_ those by stopping premature deletion; it does not implement them.
- Changing the on-disk/in-memory storage format. `PlainReqResMeta` is unchanged.
- Adding `{ includeStale }` plumbing to `CachePersistenceLike.get()` or
  `[Symbol.asyncIterator]`. Persistence behavior under each mode is fully
  determined by the construction options.
- Introducing a future `'ttl'` mode. The combination `'retain'` + custom
  `maxPersistenceTtlMs` covers the pure-TTL use case; no new mode is needed for
  it. The string-valued shape still leaves room for things like `'custom'`
  (caller-supplied predicate) if that ever becomes useful, but the immediate
  motivating use case is resolved.

## Decisions

### Decision 1: A single string-valued option `staleRetention` rather than a boolean

**Choice:** `staleRetention?: 'evict' | 'retain'` on
`CachePersistenceBaseOptions`, defaulting to `'evict'`.

**Rationale:** A boolean (`retainStale: true`) would name the wrong axis
(presence of a single behavior). The string-valued shape leaves room for
additional non-binary modes (`'custom'`, etc.) if a need arises. The name
`staleRetention` is precise: it answers "what do we do with stale entries?"
rather than "do we expire them?" (which is ambiguous between "track expiration"
and "evict on expiration").

**Alternatives considered:**

- `retainStale: boolean` — rejected, see above.
- `expirationPolicy: 'evict' | 'retain'` — close, but too broad and could
  plausibly be misread as configuring what _counts_ as expiration (e.g. honoring
  `Expires` vs `Cache-Control`).
- Two separate options (`scheduleDeletionOnExpiry: boolean`,
  `filterStaleOnGet: boolean`) — rejected as exposing implementation details and
  creating four configurations of which only two are coherent.

### Decision 2: `maxPersistenceTtlMs` is a universal storage-lifetime ceiling, applied in every mode

**Choice:** Add `maxPersistenceTtlMs?: number` to `CachePersistenceBaseOptions`,
defaulting to `2_592_000_000` ms (30 days — same as today's hardcoded value).
The base constructor initializes `this._maxPersistenceTtlMs` from this option,
preserving the protected field for subclasses that read it directly. The option
is **applied in every `staleRetention` mode**, not gated to `'retain'`.

**Semantics:**

- `_expiresIn(response)` continues to cap its computed value at
  `maxPersistenceTtlMs`. No change to that function's behavior — only the source
  of `_maxPersistenceTtlMs` changes (option vs. hardcoded).
- The eviction-primitive delay is:
  - Under `'evict'`: `_expiresIn(response)`, which equals
    `min(httpExpiresIn, maxPersistenceTtlMs)`. This is today's behavior exactly.
  - Under `'retain'`: `maxPersistenceTtlMs`. HTTP expiration is not used as an
    eviction trigger; the entry sits in storage until the ceiling fires.
- The eviction primitive is **always invoked** under both modes — what differs
  is the value passed (`min(httpExpiresIn, maxPersistenceTtlMs)` vs.
  `maxPersistenceTtlMs`). Earlier drafts framed `'retain'` as "do not invoke the
  primitive"; this was wrong because it removed the storage-lifetime ceiling.
  The corrected framing is "the primitive always fires; the delay it fires with
  is the only thing that changes between modes".

**Rationale:** Two things motivate making the ceiling explicit and universal:

1. **Promoting an implicit contract.** `_maxPersistenceTtlMs` is already a
   load-bearing safety net for all three backends — without it, Deno KV would
   have to reject unbounded `expireIn` values, Redis would accept absurd
   `PEXPIRE` values that exhaust memory, and Memory's `setTimeout` would hit the
   32-bit signed-integer ceiling and wrap. Exposing it as a documented option
   turns a fragile-by-omission contract into a configurable one.
2. **Resolving the pure-TTL use case without a new mode.** An earlier draft
   punted "absolute TTL independent of HTTP semantics" to a future `'ttl'` mode.
   With public `maxPersistenceTtlMs`, that mode is just `'retain'` + custom
   `maxPersistenceTtlMs`, and the application ignores `x-cachestorage-stale`. No
   new mode needed.

**`maxPersistenceTtlMs` is about storage lifetime, not freshness.** This
distinction is the most important thing to communicate in docs:

- HTTP `Expires:` / `Cache-Control: max-age` → governs _freshness_. Drives
  `PlainReqResMeta.expires` and the `x-cachestorage-stale` header.
- `maxPersistenceTtlMs` → governs _storage lifetime_. Drives the
  eviction-primitive delay. An entry can be stale (past HTTP expiration) and
  still within `maxPersistenceTtlMs` — that's exactly what `'retain'` mode
  produces.

TSDoc must lead with this. README must lead with this. Naming
`maxPersistenceTtlMs` (vs. `maxAge`, which would invite confusion with HTTP
`max-age`) is part of that telegraphing.

**Backend-specific limitation:** Deno KV's native `expireIn` is capped at
2,592,000,000 ms (its own 30-day ceiling on `Deno.KvSetOptions['expireIn']`). If
`maxPersistenceTtlMs` is configured higher, Deno KV silently clamps. This is
documented as a known backend constraint — `maxPersistenceTtlMs` is "the
requested upper bound, subject to backend constraints", consistent with how this
library already exposes backend-specific options (Redis pooling, KV consistency,
etc.).

**Alternatives considered:**

- Keep `_maxPersistenceTtlMs` hidden, never expose. Rejected because (a) the
  field is already load-bearing across all backends so it deserves to be a
  contract, not an implementation detail; (b) the pure-TTL use case has no path
  without it; (c) it forces subclassing for what is fundamentally a
  configuration concern.
- Expose two separate ceilings, one for `'evict'` and one for `'retain'`.
  Rejected as needlessly complex — the ceiling is the _same_ concept in both
  modes (max time in storage), just interacting differently with HTTP-derived
  delays.
- Name it `maxAge`, `maxExpireIn`, or `maxStorageLifetime`. Rejected:
  - `maxAge` collides with HTTP `Cache-Control: max-age` — the very confusion we
    want to avoid.
  - `maxExpireIn` was used in earlier drafts. Rejected because (a) it doesn't
    carry the library's "persistence" vocabulary (`CachePersistenceLike`,
    `CachePersistenceBase`, the package name `web-cache-api-persistence`); (b)
    it has no unit suffix, which is a footgun in a domain where Redis (`EXPIRE`,
    seconds), DNS records, and most CDN TTL controls all express lifetimes in
    **seconds** while this library uses **milliseconds** throughout. A silent
    unit mismatch where a caller writes `maxExpireIn: 60` thinking
    minutes/seconds and gets 60 ms is exactly the kind of confusion the suffix
    prevents.
  - `maxStorageLifetime` is descriptive but verbose, doesn't carry the
    "persistence" library vocabulary, and lacks the unit suffix for the same
    reason as `maxExpireIn`.
  - **Chosen: `maxPersistenceTtlMs`.** "Persistence" aligns with the library's
    existing vocabulary. "Ttl" (time-to-live) is the standard term for
    absolute-lifetime ceilings in caching infrastructure. The `Ms` suffix is
    deliberate: it makes the unit explicit and prevents silent mismatches with
    seconds-based conventions elsewhere in the ecosystem.

### Decision 3: The eviction primitive is ALWAYS invoked; only the delay changes between modes

**Choice:** Under both `'evict'` and `'retain'`, every `put()` results in
exactly one call to the eviction primitive (Memory `setTimeout`, Deno KV
`setBlob` with `expireIn`, Redis `PEXPIRE`). The argument differs:

- `'evict'`: `_expiresIn(response)` → `min(httpExpiresIn, maxPersistenceTtlMs)`.
- `'retain'`: `maxPersistenceTtlMs`.

**Rationale:** This is the consequence of Decision 2. If `'retain'` _skipped_
the primitive, entries would accumulate forever (or until the backend's own
policies — Redis `maxmemory-policy`, KV cap — kicked in), which is the
unbounded-growth risk from earlier drafts. With `maxPersistenceTtlMs` as a
universal ceiling, that risk vanishes: `'retain'` is bounded by
`maxPersistenceTtlMs`. The implementation is correspondingly simpler — there is
no "skip-the-primitive" branch to test for. Tests assert the _value passed_ to
the primitive (`setTimeout` delay, `setBlob`'s `expireIn`, `PEXPIRE`'s ms arg),
not its absence.

**Alternatives considered:**

- Skip the primitive under `'retain'`, rely on backend policies for backstop.
  Rejected per above — opaque, backend-specific, and shifts the burden to the
  operator. The hidden 30-day cap is already doing real work in production
  today; making it explicit and consistent is strictly better.
- Conditional cleanup loop in `get()` under `'retain'` (lazy eviction). Rejected
  as adding load to the read path for negligible benefit; the primitive-driven
  eviction is the established pattern.

### Decision 4: `_expiresIn()` represents pure HTTP freshness; storage clamping moves to `_evictionDelay()`

**Choice:** Refactor `_expiresIn(response)` in `src/cache-persistence-base.ts`
to compute _pure HTTP freshness_ with no awareness of `_maxPersistenceTtlMs` or
`staleRetention`. Specifically:

1. The `Cache-Control: max-age` / `s-maxage` branch (lines 117-121 of the
   current file) keeps its `msLeft` computation but returns `Math.round(msLeft)`
   — the `Math.min(..., this._maxPersistenceTtlMs)` clamp is removed.
2. The `Expires` branch (lines 126-130) keeps its `msLeft` computation but
   returns `Math.round(msLeft)` — the same clamp is removed.
3. The fallback branch (line 132) returns `0` instead of
   `this._maxPersistenceTtlMs`. A response with neither `Cache-Control` nor
   `Expires` has no explicit HTTP freshness lifetime per RFC 9111 §4.2.1.

All storage-lifetime clamping moves to the new helper
`_evictionDelay(httpExpiresIn): number`:

```ts
protected _evictionDelay(httpExpiresIn: number): number {
    return this._staleRetention === 'evict'
        ? Math.min(httpExpiresIn, this._maxPersistenceTtlMs)
        : this._maxPersistenceTtlMs;
}
```

The call sites that previously passed `_expiresIn(response)` directly to the
eviction primitive (Memory `_scheduleRemoval`, Deno KV `setBlob.expireIn`, Redis
`PEXPIRE` ms arg) now pass `_evictionDelay(_expiresIn(response))`.

**Rationale:** Today's `_expiresIn` conflates three concerns into one function:
(a) HTTP freshness math, (b) a 30-day clamp on overshoots, and (c) a 30-day
fallback for header-less responses. The first is HTTP semantics. The second and
third are storage policy. The current implementation hides this conflation
behind a single function name, and as a consequence:

- **It's quietly aggressive.** A response with no `Cache-Control` and no
  `Expires` is silently cached for 30 days. RFC 9111 §4.2.1 says such a response
  has no explicit freshness lifetime; §4.2.2 allows heuristic freshness only
  conditionally and requires the cache to attach a `Warning: 113` header
  (obsolete per RFC 9111 itself, but the underlying spirit — heuristic freshness
  is opt-in, not default — stands). A 30-day default heuristic, applied with no
  signal to the consumer, is not behavior we should ship under the banner of an
  HTTP-semantics method.
- **It hides the storage clamp.** Under the two-axis design, the
  storage-lifetime clamp belongs at the call site that combines HTTP freshness
  with `maxPersistenceTtlMs` — that is, `_evictionDelay`. Leaving the clamp
  inside `_expiresIn` makes `'retain'` mode's "fire at `maxPersistenceTtlMs`
  regardless of HTTP" semantics harder to read in the code, and creates a
  redundant clamp in the `'evict'` branch (the `Math.min` in `_evictionDelay` is
  then over an already-clamped value).
- **It corrupts `PlainReqResMeta.expires`.** `_pairToPlain` writes
  `expires = Date.now() + _expiresIn(response)` into the stored payload. With
  the current implementation, a header-less response gets `expires = now + 30d`
  — and `_hasExpired(meta)` reads `Date.now() > +meta.expires`, so for 30 days
  the entry reads as _fresh_ per the metadata. That's metadata that lies about
  HTTP semantics. After the fix, `expires === created` for header-less
  responses, so `_hasExpired` correctly returns `true` immediately on read.

**Behavioral consequences after the fix:**

| Response shape                                | Before (current code)                                         | After (this change)                                                                                                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Cache-Control: max-age=3600`                 | `_expiresIn → 3_600_000`; `expires → now + 3_600_000`         | identical (clamp doesn't fire below 30d)                                                                                                                                                          |
| `Cache-Control: max-age=315360000` (10 years) | `_expiresIn → 2_592_000_000` (clamped); `expires → now + 30d` | `_expiresIn → 315_360_000_000` (no clamp); `expires → now + 10y`. Eviction delay under `'evict'` is `min(10y, 30d) = 30d` via `_evictionDelay`, same as before. Under `'retain'`, delay is `30d`. |
| `Expires: <far future>`                       | clamped to 30d                                                | unchanged, no clamp in `_expiresIn`; ceiling applied at `_evictionDelay`                                                                                                                          |
| No `Cache-Control`, no `Expires`              | `_expiresIn → 30d`; `expires → now + 30d`; cached 30 days     | **`_expiresIn → 0`; `expires → now`; under `'evict'` eviction fires ~immediately; under `'retain'` entry is immediately stale (marker header set) but retained for `maxPersistenceTtlMs`**        |

The first three rows preserve user-observable behavior for the common case. The
fourth row is the bug-fix-grade change: header-less responses no longer enjoy a
hidden 30-day cache.

**RFC reference:** RFC 9111 §4.2.1 ("Calculating Freshness Lifetime") enumerates
the explicit sources — `s-maxage`, `max-age`, `Expires` — and says: _"If none of
[these] are present, then this method does not apply."_ §4.2.2 ("Calculating
Heuristic Freshness") permits implementations to compute heuristic lifetimes
only under specific conditions (cacheable response, has `Last-Modified`, etc.).
The current `_expiresIn` returns 30 days unconditionally, which is neither
§4.2.1-compliant (no explicit lifetime) nor §4.2.2-compliant (no heuristic
input). The fix aligns with §4.2.1: `_expiresIn` returns `0` for header-less
responses, and any future heuristic policy can be added as a separate, opt-in
concern.

**Effect on retain-mode storage of header-less responses:** under `'retain'`, a
header-less response is immediately stale (`x-cachestorage-stale: 1` set on
first read) but is still retained in storage for `maxPersistenceTtlMs`. This is
correct: the application opted into `'retain'`, so it's free to consult the
marker and either revalidate or serve as-is. Under `'evict'`, the same response
is evicted at delay `0` because the user did not opt into retention and the
response carries no freshness signal that would justify storing it. Both
behaviors fall out of the unified design with no special-casing.

**Alternatives considered:**

- Keep the clamp in `_expiresIn` and the `_maxPersistenceTtlMs` fallback.
  Rejected because it bakes storage policy into HTTP-semantics code and quietly
  violates RFC 9111. Also makes `_evictionDelay`'s `'evict'` branch redundant
  (clamping an already-clamped value).
- Implement RFC 9111 §4.2.2 heuristic freshness as the fallback. Rejected as out
  of scope for this change — it requires consulting `Last-Modified` and applying
  a fraction (the spec suggests 10% of the time since `Last-Modified`), which is
  a separate, opt-in feature that deserves its own design. Returning `0` is the
  conservative, correct-by-default answer; users wanting heuristic freshness can
  set explicit `Cache-Control` before `put`-ing.
- Return `Infinity` (or some sentinel) for the fallback to mean "no opinion".
  Rejected as more confusing than `0` and harder to reason about in the
  `_evictionDelay` `min(...)` computation. `0` means "no freshness", which is
  unambiguous and exactly what RFC 9111 §4.2.1 implies.

### Decision 5: Persistence-layer filtering is determined by `staleRetention`, not a per-call option

**Choice:** The signatures of `CachePersistenceLike.get()` and
`CachePersistenceLike[Symbol.asyncIterator]` are **unchanged**. Their _behavior_
depends on the construction-time `staleRetention`:

- Under `'evict'`: `get()` and the async iterator skip entries whose `expires`
  is in the past (preserves today's defensive `_hasExpired` check, which also
  covers eviction-timing races).
- Under `'retain'`: `get()` and the async iterator yield entries past their
  `expires`, and the materialized `Response` carries `x-cachestorage-stale: 1`.

**Rationale:** Under the revised framing, the _whole point_ of `'retain'` is
that the `Cache` layer should be able to do its W3C-specified job — "return
whatever matches" — without knowing anything about freshness. If `get()`
filtered stale entries under `'retain'`, then `Cache.match()` would silently
hide entries the spec says it should return, defeating the mode. And if
`'evict'` had to be told "yes, please filter" via an option, that would be
redundant — the persistence already knows what mode it's in.

A per-call `{ includeStale }` option was considered (and was in an earlier draft
of this design). It was dropped because: (a) it forced the `Cache` layer to know
about staleness and pass the right flag, contradicting the goal of leaving
`Cache` unmodified; (b) it created a four-cell matrix (mode × option) of which
only two cells are meaningful (`'retain' + true`, `'evict' + false`); (c) it
complicated `CachePersistenceLike` for third-party implementers who would have
to honor an option that means nothing for their (assumed-single-mode)
implementation.

**Alternatives considered:**

- Filter in both modes; expose stale only via a new method or option — rejected
  because it requires `Cache` changes.
- Always yield-all; filter in the persistence's `get()` only via a new option —
  rejected as breaking change for third-party persistences that already filter
  internally; also forces `Cache` to thread the option through.

### Decision 6: Mark stale entries via `x-cachestorage-stale: 1` header — as a convenience, not a contract

**Choice:** When the bundled persistence yields an entry whose `expires` is in
the past (only possible under `'retain'`), the materialized `Response` has
`x-cachestorage-stale` set to `'1'` in its headers. The header is attached in
the same place where `age` and `x-cachestorage-id` are already attached
(`cache-persistence-base.ts:_plainToResponse`).

**Rationale:** Application code under `'retain'` needs to know whether what it
just got back from `cache.match(req)` is fresh or stale, so it can decide
whether to revalidate or serve as-is. The minimum it needs is a boolean.
Reasonable alternatives:

- Have the app re-parse `Cache-Control`/`Expires`/`Date`/`Age` itself. Correct
  but tedious and easy to get wrong (esp. `Age`-correction for chained caches).
- Expose persistence-layer metadata via some side channel (`WeakMap`,
  return-shape change). Brittle (Response identity isn't preserved across
  `clone()`) or breaking (changes the `CachePersistenceLike` contract).
- Set a custom header on the materialized Response. This is the pattern this
  codebase already uses (`age`, `x-cachestorage-id`), it's parseable, it
  survives `clone()`, and it doesn't change any interface signature.

The header is best understood as **observable metadata, not protocol**. The
`Cache` interface contract doesn't depend on it. Applications that don't read it
still get spec-conforming behavior — they just have to do their own freshness
analysis. Applications that read it get a cheap shortcut. Critically:
applications using `'retain'` + custom `maxPersistenceTtlMs` as a pure-TTL cache
can simply ignore the header.

**Note on RFC 9111 `Warning` header:** Setting
`Warning: 110 - "Response is Stale"` was considered. Rejected because `Warning`
was obsoleted in RFC 9111 §5.5 (Sep 2022) and SHOULD be removed by recipients.
The custom `x-cachestorage-stale` is explicit, parseable, won't conflict with
future HTTP semantics, and matches the existing `x-cachestorage-*` namespace.

**Alternatives considered:**

- Changing `get()`'s yield type from `[Request, Response]` to
  `[Request, Response, { stale: boolean }]` — rejected as a breaking change to
  the `CachePersistenceLike` contract.
- A `WeakMap<Response, { stale: boolean }>` exported from the module — rejected
  as fragile and awkward to consume.

### Decision 7: `Cache.match`/`matchAll`/`keys` are unmodified

**Choice:** The `Cache` layer (`src/cache.ts`) is **not changed**.
`match`/`matchAll`/`keys` continue to call
`_persistence.get(cacheName, request)` /
`_persistence[Symbol.asyncIterator](cacheName)` and trust whatever is yielded.
Under `'evict'` they see only fresh entries (persistence filtered). Under
`'retain'` they see all entries (persistence didn't filter), and that is
spec-conforming — the W3C `Cache` interface has no concept of freshness.

**Rationale:** A previous draft added a `Cache.matchIncludingStale()` companion.
That was wrong: under `'retain'`, hiding stale entries from `match()` would be
_non-conforming_, because the spec says `match()` returns matches. The companion
method was therefore solving a problem the simpler design doesn't have.

`Cache.put`'s internal call to `this.match(request)` to delete a pre-existing
pair: under `'retain'`, naturally finds and deletes stale predecessors too
(because `match()` returns them). No change needed there.

**Alternatives considered:**

- `Cache.matchIncludingStale(request, options?): Promise<{ response, stale } | undefined>`
  — rejected per above.
- A `matchOptions: { rejectStale: boolean }` option on `match()` — rejected as
  augmenting the W3C return shape contract.

### Decision 8: The four canonical configurations

The two-axis design produces four documented configurations. README and TSDoc
must include this table:

| `staleRetention`    | `maxPersistenceTtlMs`                                                | Behavior                                                                                                                                                                            | When to use                                                                                 |
| ------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `'evict'` (default) | `2_592_000_000` (default)                                            | HTTP-cache pragmatism. Entries evicted at `min(httpExpiresIn, 30d)`. Today's behavior.                                                                                              | General HTTP caching where revalidation is not needed.                                      |
| `'retain'`          | `2_592_000_000` (default)                                            | HTTP-cache with revalidation support. Entries become stale at HTTP expiration but stay retrievable up to 30 days; `x-cachestorage-stale` signals freshness.                         | Caches that want `ETag`/`Last-Modified` revalidation, SWR, SIE.                             |
| `'retain'`          | Custom (e.g. `60_000`)                                               | Pure absolute-TTL cache, ignores HTTP semantics. Entries live exactly `maxPersistenceTtlMs` ms regardless of `Cache-Control`. Application typically ignores `x-cachestorage-stale`. | Session caches, computed-value caches, anywhere the upstream `Cache-Control` is irrelevant. |
| `'retain'`          | Very large (e.g. `Number.MAX_SAFE_INTEGER`, subject to backend caps) | Maximally spec-pure W3C `Cache`. Entries persist effectively until `Cache.delete()`.                                                                                                | Service-Worker-style caches; tests; deliberately spec-conforming setups.                    |

A fifth row exists in principle (`'evict'` + custom `maxPersistenceTtlMs`) but
is rarely the right answer: it just shortens the ceiling for entries lacking
HTTP expiration headers, which is a niche need. Documented as a footnote, not a
recommended configuration.

### Decision 9: NoOp persistence is exempt

**Choice:** `CachePersistenceNoop` accepts both `staleRetention` and
`maxPersistenceTtlMs` but ignores them. It stores nothing, so neither retention
policy nor storage-lifetime ceiling has any observable effect.

## Risks / Trade-offs

- **[Risk]** Users misread `maxPersistenceTtlMs` as a freshness knob (e.g. "set
  this to 60 s to expire entries after 60 s like `max-age=60`"). →
  **Mitigation:** TSDoc leads with "universal upper bound on entry **storage
  lifetime**, applied in all modes" and explicitly contrasts with HTTP
  `Expires:` / `Cache-Control`. README's two-axis table makes the distinction
  concrete. Naming (`maxPersistenceTtlMs` vs. e.g. `maxAge`) deliberately avoids
  HTTP vocabulary to reduce confusion.
- **[Risk]** Users on `'retain'` with a long `maxPersistenceTtlMs` and no
  application-level cleanup see large caches. → **Mitigation:** The default
  `maxPersistenceTtlMs` is `2_592_000_000` ms (30 days), matching today's hidden
  ceiling — so default behavior is bounded. Users who explicitly raise
  `maxPersistenceTtlMs` are opting into longer retention and own the
  consequences. Redis users pair with `maxmemory-policy`; Deno KV users hit the
  native 30-day cap; Memory users may pair with an application-level cleanup
  job. None of this is unbounded; the difference from earlier drafts is that the
  bound is now an explicit, configurable contract.
- **[Risk]** Deno KV silently clamps `expireIn` to its native 30-day cap. A user
  setting `maxPersistenceTtlMs: 60 * 24 * 60 * 60_000` (60 days) on Deno KV will
  see entries evicted at 30 days, not 60. → **Mitigation:** Document explicitly
  in TSDoc on `CachePersistenceDenoKvOptions` and in the README's "Additional
  modules → Deno KV" subsection. Frame `maxPersistenceTtlMs` as "the requested
  upper bound, subject to backend constraints" — consistent with how this
  library already documents Redis-specific connection caps and KV consistency
  levels.
- **[Risk]** Application code under `'retain'` that calls `cache.match()` and
  assumes "if I got a Response back, it's fresh" will silently serve stale data.
  → **Mitigation:** The `x-cachestorage-stale` header is the documented escape
  hatch; README example shows the canonical branch. This is intrinsic to opting
  into W3C semantics — the spec defines no freshness concept, so the application
  must take responsibility. (Note: pure-TTL configurations under `'retain'` +
  small `maxPersistenceTtlMs` intentionally ignore the header — that's correct
  usage for that pattern.)
- **[Risk / bug-fix-grade behavior change]** Responses without `Cache-Control`
  and without `Expires` were silently cached for 30 days (Decision 4 → "It's
  quietly aggressive"). After this change, under default `'evict'` they are
  evicted ~immediately; under `'retain'` they are immediately stale on read but
  retained for `maxPersistenceTtlMs`. Existing user code that relied on the
  implicit 30-day cache for header-less responses will break: a `put` of a
  header-less response is no longer retrievable by a subsequent `match` under
  default configuration. → **Mitigation:** Position in the CHANGELOG as a bug
  fix (RFC 9111 §4.2.1 alignment), not a feature regression. Migration is
  trivial — the caller sets explicit `Cache-Control: max-age=N` on the response
  before `put`-ing it. The library's own test suite
  (`src/cache-storage.test.ts`) contains many tests that put header-less
  `new Response('Hello, world!')` objects and immediately match them; these are
  audited and updated as part of this change (separate task). The audit's
  findings are the canonical guide for external users — most occurrences are
  incidental (author didn't set headers because the test wasn't about
  expiration) and want explicit `Cache-Control` added; a few may have been
  intentionally testing the 30-day fallback and need to be deleted as encoding a
  now-fixed bug.
- **[Risk]** The `x-cachestorage-stale` header could collide with a real
  upstream header. → **Mitigation:** The `x-cachestorage-*` prefix is already
  used by this library (`x-cachestorage-id`) and namespaced to it. If the
  upstream Response sets it, our writes overwrite per spec — same as today's
  `age`/`x-cachestorage-id` behavior.
- **[Risk]** Subclasses of `CachePersistenceBase` overriding the protected
  `_maxPersistenceTtlMs` field (e.g. setting it in their constructor) could
  break if the base constructor sets it from `_options.maxPersistenceTtlMs`
  _after_ their override runs. → **Mitigation:** The base constructor reads
  `_options.maxPersistenceTtlMs ?? this._maxPersistenceTtlMs` (i.e. only
  overrides if the user explicitly passed the option), so a subclass that sets
  `this._maxPersistenceTtlMs = 60_000` in its own constructor and the caller
  passes no option continues to honor the subclass's value. Documented in TSDoc
  on `_maxPersistenceTtlMs`.
- **[Trade-off]** Third-party `CachePersistenceLike` implementations don't know
  about `staleRetention` or `maxPersistenceTtlMs` and won't honor them. →
  **Accepted:** Both options live on `CachePersistenceBaseOptions`; the
  `CachePersistenceLike` interface itself remains unchanged. Third-party
  persistences define their own semantics, as they always have. The `Cache`
  layer just iterates what they yield, same as today.

## Migration Plan

This change is additive at default settings — no migration required for the
common case. `staleRetention` defaults to `'evict'` and `maxPersistenceTtlMs`
defaults to `2_592_000_000`, exactly reproducing today's behavior.

**For users who want to use the new behavior:**

1. Pass `staleRetention: 'retain'` (and optionally a custom
   `maxPersistenceTtlMs`) when constructing the persistence:
   `new CachePersistenceMemory({ staleRetention: 'retain', maxPersistenceTtlMs: 60_000 })`,
   or via the factory.
2. Continue using `cache.match()` exactly as before — no API change. The
   returned Response, if present, may now be stale.
3. To detect staleness, read `response.headers.get('x-cachestorage-stale')`. If
   `'1'`, the entry is past its HTTP expiration; the application can revalidate
   (`If-None-Match` with `etag`, `If-Modified-Since` with `last-modified`),
   serve as-is (SWR-style), fall back to origin, etc. For pure-TTL use cases
   (`'retain'` + small `maxPersistenceTtlMs`), the header can be safely ignored.
4. Optionally pair with backend-level eviction backstops: Redis
   `maxmemory-policy: allkeys-lru`, or application-level cleanup. Deno KV
   enforces its own 30-day cap natively.

**For users who were `put`-ing responses without `Cache-Control` and without
`Expires` and relying on the implicit 30-day cache** (the bug-fix-grade behavior
change from Decision 4):

1. Audit your call sites. Search for `cache.put(...)` calls whose `Response`
   does not set `Cache-Control` or `Expires`.
2. For each: either (a) add `Cache-Control: max-age=N` to the response before
   `put`-ing, where `N` is the intended freshness lifetime in seconds, or (b)
   switch the persistence to `staleRetention: 'retain'` and read the
   `x-cachestorage-stale` header on retrieval to make the freshness decision in
   application code, or (c) accept that header-less responses are no longer
   cacheable (this is RFC 9111-correct).
3. If your previous configuration relied on header-less responses being cached
   for exactly 30 days with no other signal, option (a) with
   `Cache-Control: max-age=2592000` reproduces that behavior explicitly.

**For users currently subclassing `CachePersistenceBase` to override
`_maxPersistenceTtlMs`:** No action required. The base constructor preserves a
pre-set `_maxPersistenceTtlMs` value when no `maxPersistenceTtlMs` option is
provided. To adopt the option-based path, remove the subclass override and pass
`maxPersistenceTtlMs` via options instead.

**Rollback:** Remove `staleRetention` and `maxPersistenceTtlMs` from the
persistence options. No data migration needed because the storage format is
unchanged. Application code branching on `x-cachestorage-stale` can stay — the
header will simply never appear under `'evict'`.

## Development Process — Test-Driven Development

This change is implemented strictly **RED → GREEN → (Refactor)**. The rules:

- **No production code is written before a failing test exists for the behavior
  it implements.** Every new behavior in `cache-persistence-storage` and
  `cache-freshness-policy` spec deltas has a corresponding test authored
  _first_, observed to fail (RED) against the current `main` branch, and only
  then is implementation code added until the test passes (GREEN).
- **Tasks are grouped into RED/GREEN/Verify triplets in `tasks.md`.** Each
  implementation task group is preceded by a "Write failing tests for X" task
  group with an explicit RED gate checkbox ("Confirm tests fail before
  implementation"). The implementation task group has a GREEN gate checkbox
  ("Confirm tests now pass"). Each slice ends with a regression checkbox ("Run
  full test suite — no regressions").
- **Test framework, command, and conventions** (confirmed by inspecting the
  repo, not assumed):
  - Test runner: `deno test -A --parallel --unstable-kv`, exposed as
    `deno task test` in `deno.json`. CI variant: `deno task test:ci` (excludes
    `cache-persistence-redis.test.ts`).
  - Test file naming: `*.test.ts` (dot, not underscore). New tests go in the
    existing `src/cache-persistence-memory.test.ts`,
    `src/cache-persistence-deno-kv.test.ts`,
    `src/cache-persistence-redis.test.ts`, and/or `src/cache-storage.test.ts`.
  - Test location: colocated with source files in `src/`.
  - Framework: built-in `Deno.test` + `@std/assert` + `@std/testing/mock`
    (`spy`, `stub`, `returnsNext`, `assertSpyCalls`) + `@std/testing/time` for
    `FakeTime`.
  - Existing convention: the three per-persistence test files are thin shims
    that bind `globalThis.caches` to a different persistence and
    `await import('./cache-storage.test.ts')`. Tests through the public `Cache`
    API live once in `cache-storage.test.ts` and run against all three
    persistences automatically. Implementation-detail assertions (eviction
    primitive call args, `_timers` inspection) must live in the per-persistence
    file as standalone `Deno.test(...)` blocks placed _before_ the
    `await import('./cache-storage.test.ts')` line.
- **Scenario → test mapping is 1:1 where practical.** Every `#### Scenario:`
  block in the spec deltas corresponds to at least one `Deno.test` step or one
  top-level `Deno.test`. Scenario phrasing has been tightened so each is
  directly transcribable into executable assertions (specific headers, specific
  lengths, specific spy-call shapes — no fluffy "behaves correctly").
- **Regression discipline.** After each GREEN, the full suite (`deno task test`)
  must pass before advancing to the next RED. Do not stack multiple unfinished
  slices.
- **Refactor only with a green bar.** Any cleanup happens between GREEN and the
  next RED, with the suite passing on both sides.

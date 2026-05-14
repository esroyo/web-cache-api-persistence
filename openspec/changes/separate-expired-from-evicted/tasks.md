> **Process:** Strict TDD. Every implementation task group is preceded by a RED
> test group with an explicit "tests fail before implementation" gate.
> Implementation groups end with a "tests pass after implementation" GREEN gate
> plus a "full suite passes" regression gate. Refactor only with a green bar.
> See `design.md` → "Development Process — Test-Driven Development" for
> rationale.
>
> **Verified repo conventions:** test runner `deno task test`
> (`deno test -A --parallel --unstable-kv`); CI variant `deno task test:ci`
> excludes Redis; test file naming `*.test.ts` (dot); tests colocated in `src/`;
> framework `Deno.test` + `@std/assert` + `@std/testing/mock` (`spy`, `stub`,
> `assertSpyCalls`) + `@std/testing/time` (`FakeTime`). Per-persistence test
> files (`cache-persistence-{memory,deno-kv,redis}.test.ts`) are thin shims that
> bind `globalThis.caches` and `await import('./cache-storage.test.ts')` —
> implementation-detail tests go in the per-persistence file _before_ that
> import; `Cache`-API-level tests go in `cache-storage.test.ts` and run against
> all three persistences automatically.
>
> **Two-axis design recap:** `staleRetention` controls what happens when an
> entry passes HTTP expiration (`'evict'` deletes; `'retain'` marks stale).
> `maxPersistenceTtlMs` is the universal upper bound on storage lifetime,
> applied in both modes. The eviction primitive (`setTimeout` /
> `setBlob({expireIn})` / `PEXPIRE`) is ALWAYS invoked; what changes between
> modes is the _delay value_. Tests assert the value passed, never the absence
> of the call.
>
> **`_expiresIn` purity:** after this change, `_expiresIn` represents only HTTP
> freshness semantics. It returns the raw HTTP-derived value (no
> `_maxPersistenceTtlMs` clamp) when `Cache-Control: max-age`/`s-maxage` or
> `Expires` is present, and `0` when neither header is present (per RFC 9111
> §4.2.1). All storage clamping lives in the new `_evictionDelay(httpExpiresIn)`
> helper. This means responses without HTTP expiration headers — previously
> cached for 30 days under default `'evict'` — are now evicted ~immediately.
> Several existing tests in `src/cache-storage.test.ts` construct
> `new Response('Hello, world!')` (no headers) and immediately match it; these
> are audited and updated as part of this change (Section 6).

## 1. Slice — `staleRetention` option surface (RED)

Spec coverage: `cache-freshness-policy` → "Bundled persistence implementations
SHALL accept a staleRetention option" (all three scenarios).

- [ ] 1.1 In `src/cache-persistence-memory.test.ts`, add a top-level
      `Deno.test('staleRetention option — Memory', ...)` block (before the
      `await import('./cache-storage.test.ts')`) with a
      `t.step('accepts retain and yields stale entry')` that: constructs
      `new CachePersistenceMemory({ staleRetention: 'retain' })`, uses
      `FakeTime` from `@std/testing/time`, performs a `put` with
      `Cache-Control: max-age=1` and body `'x'`, advances
      `time.tickAsync(2000)`, consumes `get('v1', req)` into an array, and
      `assertEquals(arr.length, 1)`.
- [ ] 1.2 In `src/cache-persistence-deno-kv.test.ts`, add an equivalent
      `Deno.test('staleRetention option — Deno KV', ...)` that constructs the
      persistence with `{ staleRetention: 'retain', max: 1, min: 1 }`, performs
      the same `put`, awaits a real `setTimeout(1100)` (Deno KV's `expireIn` is
      native; `FakeTime` does not control it), and asserts `arr.length === 1`.
- [ ] 1.3 In `src/cache-persistence-redis.test.ts`, add an equivalent
      `Deno.test('staleRetention option — Redis', ...)` that constructs with
      `{ staleRetention: 'retain', port, hostname: '127.0.0.1' }` (using
      `nextPort` / `startRedis` from `test-utils.ts`), performs the same `put`,
      awaits real `setTimeout(1100)`, asserts `arr.length === 1`.
- [ ] 1.4 **RED gate:** Run `deno task test` (or `test:ci` if Redis isn't
      running locally). Confirm that 1.1 and 1.2 (and 1.3 if Redis is up) FAIL —
      the `arr.length` assertion fails because `get()` skips stale entries today
      regardless of any option. Record which tests failed and how.

## 2. Slice — `staleRetention` option surface (GREEN)

- [ ] 2.1 In `src/types.ts`, extend `CachePersistenceBaseOptions` with
      `staleRetention?: 'evict' | 'retain'`. TSDoc: explain both modes
      (`'evict'` = current HTTP-cache pragmatism, default; `'retain'` = W3C-spec
      compliance, entries persist as stale up to `maxPersistenceTtlMs`), and
      reference `maxPersistenceTtlMs` as the universal ceiling that applies in
      both.
- [ ] 2.2 Confirm by visual diff that `CachePersistenceMemoryOptions`,
      `CachePersistenceDenoKvOptions`, `CachePersistenceRedisOptions` inherit
      `staleRetention` via their `extends` chain.
- [ ] 2.3 In `src/cache-persistence-base.ts`:
  - Add protected field `_staleRetention: 'evict' | 'retain'` initialized in the
    base-class constructor from `options?.staleRetention ?? 'evict'`. Shape this
    identically to `_maxPersistenceTtlMs` (also a plain protected field,
    initialized once in the constructor). The full constructor pattern is:
    ```ts
    protected _staleRetention: 'evict' | 'retain';
    protected _maxPersistenceTtlMs: number = 2_592_000_000; // default at declaration site preserves any subclass override

    constructor(options?: CachePersistenceBaseOptions) {
        this._options = { ...this._defaultOptions, ...options };
        this._staleRetention = this._options.staleRetention ?? 'evict';
        this._maxPersistenceTtlMs = this._options.maxPersistenceTtlMs
            ?? this._maxPersistenceTtlMs; // ?? preserves subclass-set declaration value when no option is passed
    }
    ```
    Note the asymmetry between the two fields' initializers is deliberate:
    `_maxPersistenceTtlMs` uses `?? this._maxPersistenceTtlMs` to preserve
    compatibility with subclasses that set the field at their declaration site
    (a pattern the proposal commits to supporting); `_staleRetention` is a new
    field with no existing subclass overrides, so a plain `?? 'evict'` is
    sufficient.
  - Update `_defaultOptions` getter to include `staleRetention: 'evict'`.
  - Extend `_plainToResponse` so it optionally accepts a second arg
    `{ stale?: boolean }`; when `stale === true`, set
    `x-cachestorage-stale: '1'` on the materialized Response (alongside existing
    `age` and `x-cachestorage-id` headers). When omitted or `false`, do not set
    the header.
- [ ] 2.4 In `src/cache-persistence-memory.ts`, update `get()` and
      `[Symbol.asyncIterator]` so that when `_hasExpired(plainReqRes)` is true:
      under `'evict'` skip (current behavior); under `'retain'` yield via
      `_plainToResponse(plain, { stale: true })`. Signatures unchanged.
- [ ] 2.5 In `src/cache-persistence-deno-kv.ts`, apply the same `'evict'` skip /
      `'retain'` yield-with-marker change to `get()` and
      `[Symbol.asyncIterator]`. Signatures unchanged.
- [ ] 2.6 In `src/cache-persistence-redis.ts`, apply the same change. Signatures
      unchanged.
- [ ] 2.7 **GREEN gate:** Re-run Section 1. Confirm 1.1, 1.2 PASS (and 1.3 if
      Redis is up).
- [ ] 2.8 **Regression gate:** Full `deno task test` (and `test:ci`). No
      regressions.

## 3. Slice — `maxPersistenceTtlMs` option surface (RED)

Spec coverage: `cache-persistence-storage` → "Storage SHALL accept
maxPersistenceTtlMs as a public option" (all five scenarios: default, Memory,
Deno KV, Redis, NoOp).

- [ ] 3.1 In `src/cache-persistence-memory.test.ts`, add
      `Deno.test('maxPersistenceTtlMs option — Memory', ...)` with steps:
  - `default value is 2_592_000_000`:
    `const p = new CachePersistenceMemory(); assertEquals((p as unknown as { _maxPersistenceTtlMs: number })._maxPersistenceTtlMs, 2_592_000_000);`
  - `provided value flows to the protected field`:
    `const p = new CachePersistenceMemory({ maxPersistenceTtlMs: 60_000 }); assertEquals((p as unknown as { _maxPersistenceTtlMs: number })._maxPersistenceTtlMs, 60_000);`
- [ ] 3.2 In `src/cache-persistence-deno-kv.test.ts`, add
      `Deno.test('maxPersistenceTtlMs option — Deno KV', ...)` with one step
      asserting
      `(new CachePersistenceDenoKv({ maxPersistenceTtlMs: 60_000, max: 1, min: 1 }) as unknown as { _maxPersistenceTtlMs: number })._maxPersistenceTtlMs === 60_000`.
- [ ] 3.3 In `src/cache-persistence-redis.test.ts`, add
      `Deno.test('maxPersistenceTtlMs option — Redis', ...)` with one step
      asserting the same against
      `new CachePersistenceRedis({ maxPersistenceTtlMs: 60_000, port, hostname: '127.0.0.1' })`.
- [ ] 3.4 Create `src/cache-persistence-noop.test.ts` (if not already created in
      a later section's task, otherwise add a step in that file): construct
      `new CachePersistenceNoop({ maxPersistenceTtlMs: 60_000, staleRetention: 'retain' })`,
      await `put`, consume `get` into array; assert `put === false`,
      `arr.length === 0`.
- [ ] 3.5 **RED gate:** Run `deno task test`. 3.1 second step, 3.2, and 3.3 FAIL
      because `_maxPersistenceTtlMs` is currently a hardcoded field, not
      initialized from options. 3.1 first step and 3.4 may PASS as regression
      guards (the default value is correct; noop accepts unknown options
      silently). Record actual failures.

## 4. Slice — `maxPersistenceTtlMs` option surface (GREEN)

- [ ] 4.1 In `src/types.ts`, extend `CachePersistenceBaseOptions` with
      `maxPersistenceTtlMs?: number`. TSDoc MUST lead with: "Universal upper
      bound on entry storage lifetime, in milliseconds. Applied in every
      `staleRetention` mode. This is distinct from HTTP `Expires:` /
      `Cache-Control` freshness semantics — it bounds how long an entry CAN
      remain in storage at all, regardless of HTTP expiration. Under `'evict'`,
      the eviction primitive fires at `min(httpExpiresIn, maxPersistenceTtlMs)`.
      Under `'retain'`, the eviction primitive fires at `maxPersistenceTtlMs`;
      HTTP expiration only marks the entry as stale. @default 2_592_000_000 (30
      days)". Include a note about Deno KV's native 30-day cap.
- [ ] 4.2 In `src/cache-persistence-base.ts`:
  - Update `_defaultOptions` to include `maxPersistenceTtlMs: 2_592_000_000`.
  - In the constructor (or wherever `this._options` is finalized), update
    `this._maxPersistenceTtlMs` to
    `this._options.maxPersistenceTtlMs ?? this._maxPersistenceTtlMs`. The
    `?? this._maxPersistenceTtlMs` form preserves subclass overrides that set
    `_maxPersistenceTtlMs` in their own constructor when no option is passed
    (per Risk in `design.md`).
  - Keep the hardcoded protected-field initializer at `2_592_000_000` so
    subclasses inherit a sensible default if they construct outside the option
    path.
- [ ] 4.3 **GREEN gate:** Re-run Section 3. All steps PASS.
- [ ] 4.4 **Regression gate:** Full `deno task test`. **No regressions expected
      at this point** — `_expiresIn` still uses the old clamping/fallback
      (Section 5 hasn't fired yet), so the existing tests that put header-less
      responses still pass.

## 5. Slice — `_expiresIn` cleanup to pure HTTP semantics (RED)

Spec coverage: `cache-persistence-storage` → "`_expiresIn` SHALL represent pure
HTTP freshness with no storage-policy clamping" (all four scenarios).

- [ ] 5.1 In `src/cache-persistence-memory.test.ts`, add
      `Deno.test('_expiresIn purity', ...)` with steps. Tests access
      `_expiresIn` via
      `(persistence as unknown as { _expiresIn: (r: Response) => number })._expiresIn(response)`.
      Use `Date: <now>` headers consistently so the `correctedReceivedAge` term
      is `0`.
  - Step `max-age larger than maxPersistenceTtlMs is NOT clamped`: construct
    Memory with default options. Build
    `response = new Response(null, { headers: { 'date': new Date(Date.now()).toUTCString(), 'cache-control': 'max-age=315360000' } })`
    (10 years).
    `assertEquals((persistence as any)._expiresIn(response), 315_360_000_000)`
    (or assert `Math.abs(value - 315_360_000_000) <= 50`).
  - Step `Expires far in the future is NOT clamped`: response with
    `Expires: <10 years from now>.toUTCString()` and no `Cache-Control`.
    `assert(Math.abs((persistence as any)._expiresIn(response) - 10 * 365.25 * 24 * 60 * 60 * 1000) <= 5_000)`
    (looser tolerance for date-string round-trip).
  - Step `response with neither header returns 0`:
    `response = new Response(null)`.
    `assertEquals((persistence as any)._expiresIn(response), 0)`.
  - Step `max-age=60 returns 60_000 (regression guard)`: response with
    `Cache-Control: max-age=60` and `Date: <now>`.
    `assert(Math.abs((persistence as any)._expiresIn(response) - 60_000) <= 50)`.
    This guard ensures the common path is unchanged.
- [ ] 5.2 **RED gate:** Run `deno task test`. Expected outcomes against current
      code:
  - Step 1 FAILS: today `_expiresIn` returns
    `Math.min(10y, 30d) = 2_592_000_000`, not `315_360_000_000`.
  - Step 2 FAILS: same reason.
  - Step 3 FAILS: today `_expiresIn` returns
    `this._maxPersistenceTtlMs = 2_592_000_000`, not `0`.
  - Step 4 PASSES (regression guard): `max-age=60` is below all clamps today and
    continues to work after the fix.
  - Record actual outputs.

## 6. Slice — `_expiresIn` cleanup (GREEN)

- [ ] 6.1 In `src/cache-persistence-base.ts:_expiresIn(response)`:
  - Locate the `max-age`/`s-maxage` branch (around line 121). Change
    `return Math.min(Math.round(msLeft), this._maxPersistenceTtlMs);` to
    `return Math.round(msLeft);`.
  - Locate the `Expires` branch (around line 130). Change
    `return Math.min(Math.round(msLeft), this._maxPersistenceTtlMs);` to
    `return Math.round(msLeft);`.
  - Locate the no-header fallback (around line 132). Change
    `return this._maxPersistenceTtlMs;` to `return 0;`.
- [ ] 6.2 **GREEN gate:** Re-run Section 5. All four steps PASS.
- [ ] 6.3 **Audit existing tests for header-less-response assumptions.** Run
      `deno task test`. **Many tests in `src/cache-storage.test.ts` will FAIL**
      because they `put` responses constructed as
      `new Response('Hello, world!')` (no `Cache-Control`, no `Expires`) and
      immediately `match` and assert the result is defined. Under the cleanup,
      those entries are evicted at delay `0` under default `'evict'`. Enumerate
      the failing tests by running
      `deno task test 2>&1 | grep -E '(FAILED|cache-storage)'`. Categorize each:
  - **Category A: incidental** — the test wasn't about expiration; the author
    just didn't think about headers. Fix by adding
    `'cache-control': 'max-age=3600'` (or whatever) to the `Response` headers.
    Most failures will be this category.
  - **Category B: intentional 30-day fallback test** — the test deliberately put
    a header-less response and asserted it was still retrievable later. These
    encoded the now-fixed bug. Delete or rewrite as a `'retain'`-mode test
    (header-less response + `'retain'` + read `x-cachestorage-stale`).
  - **Category C: testing a different concern** — e.g. testing `Vary` matching,
    where the response's headers are irrelevant to the test's intent but the
    test happens to depend on default-30d caching. Fix the same way as Category
    A.
  - Make the minimal edits needed; document each Category B test
    deletion/rewrite in the commit message.
- [ ] 6.4 **GREEN gate (audit):** Re-run `deno task test`. All Section 5 tests
      pass AND the previously-failing existing tests now pass with their
      explicit `Cache-Control` headers in place.
- [ ] 6.5 **Regression gate:** Full `deno task test` (and `test:ci`). No
      regressions remain.

## 7. Slice — `maxPersistenceTtlMs` bounds storage lifetime under `'evict'` (RED)

Spec coverage: `cache-persistence-storage` → "maxPersistenceTtlMs SHALL bound
entry storage lifetime in every retention mode" (scenarios "evict mode clamps
long HTTP max-age to maxPersistenceTtlMs", "evict mode with no HTTP headers
evicts immediately", "evict mode with custom maxPersistenceTtlMs smaller than
max-age uses maxPersistenceTtlMs") + `cache-freshness-policy` → "Custom
maxPersistenceTtlMs SHALL be honored" (custom-evict scenarios) + "staleRetention
SHALL default to 'evict'" (header-less scenario).

- [ ] 7.1 In `src/cache-persistence-memory.test.ts`, add
      `Deno.test('Memory evict mode — maxPersistenceTtlMs bounds storage lifetime', ...)`
      using a `setTimeout` spy. Set up:
  - `import { stub } from '@std/testing/mock';`
  - In each step:
    `using setTimeoutStub = stub(globalThis, 'setTimeout', (...args: Parameters<typeof setTimeout>) => realSetTimeout(...args));`
    where `realSetTimeout` is captured before the stub. Inspect
    `setTimeoutStub.calls[i].args[1]` to read delays. Filter to calls
    originating from `_scheduleRemoval` (the persistence's own `setTimeout` use)
    — there may be other `setTimeout` calls in the runtime; identify by the
    captured `fn`'s body or by counting only calls made between the `put`
    invocation and its promise resolution.
  - Step `clamps long max-age to default maxPersistenceTtlMs (30d)`: construct
    Memory with default options; `put` with `Cache-Control: max-age=315360000`
    (10 years) and `Date: <now>`; assert exactly one captured eviction
    `setTimeout` call has `args[1]` equal to `2_592_000_000 ± 50`.
  - Step `evicts header-less response immediately`: construct Memory with
    default options; `put` for `new Response('hi')` (no headers); assert the
    captured eviction `setTimeout` delay equals `0` (within ±50 ms). **This is
    the bug-fix-grade behavior change — call out in commit.**
  - Step `custom maxPersistenceTtlMs caps a larger max-age`: construct
    `new CachePersistenceMemory({ maxPersistenceTtlMs: 60_000 })`; `put` with
    `Cache-Control: max-age=3600` (1 hour); assert captured delay equals
    `60_000 ± 50`.
  - Step `custom maxPersistenceTtlMs ignored when max-age is smaller`: construct
    `new CachePersistenceMemory({ maxPersistenceTtlMs: 60_000 })`; `put` with
    `Cache-Control: max-age=30`; assert captured delay equals `30_000 ± 50`.
- [ ] 7.2 **RED gate:** Run `deno task test`. After Section 6's cleanup is in:
  - `clamps long max-age to default maxPersistenceTtlMs` should PASS as a
    regression guard: `_expiresIn` returns `10y` unclamped, but `_evictionDelay`
    (still to be added in Section 9) is not yet wired into the call site —
    _however_, today's `_scheduleRemoval` is called with `_expiresIn(response)`
    which after Section 6 returns 10y, NOT the clamped 30d. So this step
    actually FAILS post-Section 6 because the unclamped 10y is now passed
    through. **This is expected and is what Section 9 fixes.** Document
    accurately.
  - `evicts header-less response immediately` PASSES after Section 6 (because
    `_expiresIn` returns 0, and that 0 is passed through to `_scheduleRemoval`).
  - `custom maxPersistenceTtlMs caps a larger max-age` FAILS until Section 9
    wires `_evictionDelay`.
  - `custom maxPersistenceTtlMs ignored when max-age is smaller` PASSES after
    Section 6 (because `_expiresIn(max-age=30)` = 30_000, and that's passed
    through — `_evictionDelay` would compute `min(30_000, 60_000) = 30_000`,
    same answer).
  - Record the exact failure set; it informs Section 9.

## 8. Slice — Memory `'retain'` schedules at `maxPersistenceTtlMs` (RED)

Spec coverage: `cache-freshness-policy` → "staleRetention: 'retain' SHALL
schedule eviction at maxPersistenceTtlMs" (Memory scenario + header-less
scenario) + `cache-persistence-storage` → "maxPersistenceTtlMs SHALL bound entry
storage lifetime in every retention mode" (retain-mode scenarios) +
`cache-freshness-policy` → "Custom maxPersistenceTtlMs SHALL be honored"
(custom-retain scenario).

- [ ] 8.1 In `src/cache-persistence-memory.test.ts`, add
      `Deno.test('Memory retain mode — schedules at maxPersistenceTtlMs', ...)`
      using `FakeTime` and `stub(globalThis, 'setTimeout', ...)`. Steps:
  - `retain with custom maxPersistenceTtlMs schedules at maxPersistenceTtlMs, not max-age`:
    construct
    `new CachePersistenceMemory({ staleRetention: 'retain', maxPersistenceTtlMs: 60_000 })`;
    `FakeTime`; `put` with `Cache-Control: max-age=1`; assert captured
    `setTimeout` delay equals `60_000 ± 50` (NOT `1000`); assert
    `Object.keys((persistence as any)._timers).length === 1` immediately after
    `put`.
  - `entry survives past HTTP expiration but before maxPersistenceTtlMs`:
    continue from above; `await time.tickAsync(30_000)`;
    `assertEquals(Object.keys((persistence as any)._storage).length, 1)`.
  - `entry is evicted at maxPersistenceTtlMs`: continue;
    `await time.tickAsync(30_001)` (total 60_001);
    `assertEquals(Object.keys((persistence as any)._storage).length, 0)`.
  - `retain with default maxPersistenceTtlMs schedules at 30 days`: fresh
    construct `new CachePersistenceMemory({ staleRetention: 'retain' })`; `put`
    with `Cache-Control: max-age=1`; assert captured `setTimeout` delay equals
    `2_592_000_000 ± 50`.
  - `retain with no headers schedules at maxPersistenceTtlMs and yields stale on read`:
    fresh construct
    `new CachePersistenceMemory({ staleRetention: 'retain', maxPersistenceTtlMs: 60_000 })`;
    `put` for `new Response('hi')` (no headers); assert captured `setTimeout`
    delay equals `60_000 ± 50`; consume `get` into array;
    `assertEquals(arr.length, 1)`;
    `assertEquals(arr[0][1].headers.get('x-cachestorage-stale'), '1')`.
- [ ] 8.2 **RED gate:** Run `deno task test`. After Section 6, the eviction
      primitive still receives `_expiresIn(response)` directly (1000 ms for
      max-age=1, 0 for no headers). All five steps FAIL: delays of 1000 / 1000 /
      1000 / 1000 / 0 vs. expected 60_000 / (alive) / (gone) / 2_592_000_000 /
      60_000. Record specifics.

## 9. Slice — `_evictionDelay` helper + Memory wiring (GREEN)

- [ ] 9.1 In `src/cache-persistence-base.ts`, add a protected method
      `_evictionDelay(httpExpiresIn: number): number`:
  ```ts
  protected _evictionDelay(httpExpiresIn: number): number {
      return this._staleRetention === 'evict'
          ? Math.min(httpExpiresIn, this._maxPersistenceTtlMs)
          : this._maxPersistenceTtlMs;
  }
  ```
- [ ] 9.2 In `src/cache-persistence-memory.ts:_dbSet`, change the existing
      `this._scheduleRemoval(persistenceKey, expiresIn)` call site so that the
      delay passed is `this._evictionDelay(expiresIn)` rather than `expiresIn`
      directly. The eviction primitive is ALWAYS called — what changes is the
      delay value.
- [ ] 9.3 **GREEN gate:** Re-run Sections 7 and 8. All steps PASS:
  - Section 7 step 1: `_evictionDelay(10y)` under `'evict'` =
    `min(10y, 30d) = 30d` ✓
  - Section 7 step 2: `_evictionDelay(0)` under `'evict'` = `min(0, 30d) = 0` ✓
    (header-less)
  - Section 7 step 3: `_evictionDelay(3600_000)` under `'evict'` with
    `maxPersistenceTtlMs=60_000` = `60_000` ✓
  - Section 7 step 4: `_evictionDelay(30_000)` under `'evict'` with
    `maxPersistenceTtlMs=60_000` = `30_000` ✓
  - Section 8 all steps: `_evictionDelay(*)` under `'retain'` =
    `maxPersistenceTtlMs` regardless of input ✓
- [ ] 9.4 **Regression gate:** Full `deno task test`. Section 1 `'retain'` tests
      still PASS (independent of delay path). Section 6 audit tests still PASS
      (their explicit `Cache-Control` flows through correctly).

## 10. Slice — Deno KV `'retain'` passes `maxPersistenceTtlMs` as `expireIn` (RED)

Spec coverage: `cache-freshness-policy` → "staleRetention: 'retain' SHALL
schedule eviction at maxPersistenceTtlMs" (Deno KV scenario) + "Custom
maxPersistenceTtlMs SHALL be honored" (Deno KV inheritance).

- [ ] 10.1 In `src/cache-persistence-deno-kv.test.ts`, add
      `Deno.test('Deno KV retain mode — setBlob receives expireIn = maxPersistenceTtlMs', ...)`.
      Spy strategy: spy on the kv-toolbox `setBlob` import boundary by replacing
      the import binding (`import * as kvToolbox from '@kitsonk/kv-toolbox';`
      and then
      `using setBlobSpy = stub(kvToolbox, 'setBlob', kvToolbox.setBlob);` —
      `stub` with a passthrough function so the real call still happens, but
      call args are recorded). Steps:
  - `retain with custom maxPersistenceTtlMs passes expireIn = maxPersistenceTtlMs`:
    construct
    `new CachePersistenceDenoKv({ staleRetention: 'retain', maxPersistenceTtlMs: 60_000, max: 1, min: 1 })`;
    `put` with `Cache-Control: max-age=1`; assert the recorded
    `setBlobSpy.calls[i].args[2]?.expireIn === 60_000` (i = whichever index
    corresponds to the value-blob `set`, not the index-collection `set`).
  - `retain with default maxPersistenceTtlMs passes expireIn = 30 days`: same
    setup but no `maxPersistenceTtlMs` option; assert
    `expireIn === 2_592_000_000`.
- [ ] 10.2 **RED gate:** Run `deno task test`. Tests FAIL because today's
      `setBlob` call passes `{ expireIn: expiresIn }` (the HTTP-derived value,
      `1000` for max-age=1) regardless of mode. After Sections 2/6/9 (which only
      fixed Memory's call site), the Deno KV write path still passes
      `expiresIn`. Confirm.

## 11. Slice — Deno KV `'retain'` passes `maxPersistenceTtlMs` (GREEN)

- [ ] 11.1 In `src/cache-persistence-deno-kv.ts`, locate the `setBlob` call site
      (line ~226) that currently reads
      `setBlob(key, this._serialize(value), { expireIn })`. Change
      `{ expireIn }` to `{ expireIn: this._evictionDelay(expireIn) }`. The
      eviction primitive is ALWAYS called with an `expireIn` — what differs is
      the value.
- [ ] 11.2 Note: the separate index-collection
      `set(indexKey, index, { expireIn: this._maxPersistenceTtlMs })` (line
      ~205, ~225) stays as-is. That's an index-lifetime cap (always at
      `_maxPersistenceTtlMs`), conceptually consistent with the new semantics:
      indexes live for the same maximum as values under `'retain'`, and longer
      than HTTP expiration under `'evict'` (which was true before this change
      too).
- [ ] 11.3 **GREEN gate:** Re-run Section 10. Both steps PASS.
- [ ] 11.4 **Regression gate:** Full `deno task test`. No regressions. In
      particular, the Section 1 Deno KV retain test (which relies on
      `arr.length === 1` after 1100 ms with default 30-day
      `maxPersistenceTtlMs`) continues to pass — `setBlob` now passes
      `expireIn: 2_592_000_000`, so Deno KV doesn't evict during the 1100 ms
      window.

## 12. Slice — Redis `'retain'` issues `PEXPIRE` with `maxPersistenceTtlMs` (RED)

Spec coverage: `cache-freshness-policy` → "staleRetention: 'retain' SHALL
schedule eviction at maxPersistenceTtlMs" (Redis scenario) + "Custom
maxPersistenceTtlMs SHALL be honored" (Redis inheritance).

- [ ] 12.1 In `src/cache-persistence-redis.test.ts`, add
      `Deno.test('Redis retain mode — PEXPIRE = maxPersistenceTtlMs', ...)`. Spy
      strategy: wrap the redis client. The persistence holds a `_pool` of redis
      clients; the most pragmatic interception point is to subclass
      `CachePersistenceRedis` for test purposes and override `_pool.acquire` to
      return a client whose `pipeline()` returns a spy-wrapped pipeline whose
      `sendCommand` records `[command, ...args]` invocations into a captured
      array. Alternatively, leverage the existing `instrumentRedisClient`
      machinery in `src/instrument-redis-client.ts` to capture commands via
      OpenTelemetry. Pick whichever is less invasive; the existing
      `instrument-redis-client.test.ts` shows the spy-pipeline pattern (lines
      11-30).
- [ ] 12.2 Steps:
  - `retain with custom maxPersistenceTtlMs issues PEXPIRE with maxPersistenceTtlMs ms`:
    construct
    `new CachePersistenceRedis({ staleRetention: 'retain', maxPersistenceTtlMs: 60_000, port, hostname: '127.0.0.1' })`;
    `put` with `Cache-Control: max-age=1`; assert captured commands include at
    least one `['PEXPIRE', <key>, 60_000]` (or `60_000 ± 50` if rounding
    occurs); assert the COUNT of `PEXPIRE` invocations matches what `'evict'`
    mode would produce (same number of calls, not fewer).
  - `retain with default maxPersistenceTtlMs issues PEXPIRE with 30 days ms`:
    same setup without `maxPersistenceTtlMs`; assert `2_592_000_000` (within
    tolerance).
- [ ] 12.3 **RED gate:** Run `deno task test` (or `test:ci` if Redis
      unavailable). Tests FAIL because today's `PEXPIRE` is sent with
      `expiresIn` (the HTTP-derived `1000`). Record.

## 13. Slice — Redis `'retain'` issues `PEXPIRE` with `maxPersistenceTtlMs` (GREEN)

- [ ] 13.1 In `src/cache-persistence-redis.ts`, locate the two `PEXPIRE` sends
      (lines ~308 and ~314-316). Change the ms argument from `expiresIn` (or
      `Math.min(expiresIn, this._maxPersistenceTtlMs)`) to
      `this._evictionDelay(expiresIn)`. The COUNT of `PEXPIRE` invocations does
      not change — Redis under `'retain'` still issues the same set of
      `PEXPIRE`s, just with the universal-ceiling value.
- [ ] 13.2 **GREEN gate:** Re-run Section 12. Both steps PASS.
- [ ] 13.3 **Regression gate:** Full `deno task test`. The Section 1 Redis
      retain test (1100 ms window under default 30-day `maxPersistenceTtlMs`)
      continues to pass.

## 14. Slice — End-to-end `Cache.match()` returns stale under `'retain'` (RED)

Spec coverage: `cache-persistence-storage` → "Stale Responses yielded from
storage SHALL carry an x-cachestorage-stale header" (marker observable through
Cache.match) + "get() and the async iterator SHALL yield stale entries when
configured with staleRetention 'retain'".

- [ ] 14.1 In each of `src/cache-persistence-{memory,deno-kv,redis}.test.ts`,
      add a
      `Deno.test('Cache.match end-to-end — retain returns stale entry with marker', ...)`
      (each in its own file, each constructing its own `CacheStorage` with the
      relevant persistence + `{ staleRetention: 'retain' }`):
  - For Memory: use `FakeTime` plus `Cache-Control: max-age=1`, advance
    `time.tickAsync(2000)`, then `await cache.match(req)`. Assert
    `matched !== undefined`, `await matched.text() === 'hello'`,
    `matched.headers.get('x-cachestorage-stale') === '1'`.
  - For Deno KV and Redis: same shape using real `setTimeout(1100)`.
  - Clean up: `await caches.delete('v14')`,
    `await cache[Symbol.asyncDispose]?.()`.
- [ ] 14.2 **RED gate:** Run `deno task test`. All three blocks FAIL on a build
      _without_ Sections 2/9/11/13 — `cache.match` returns `undefined` because
      persistence either evicted or filtered. Confirm the actual failure mode
      against the current branch state.

## 15. Slice — End-to-end `Cache.match()` (GREEN — verification only)

- [ ] 15.1 Confirm by code inspection that, after Sections 2/9/11/13,
      `src/cache.ts` requires no changes for Section 14 to pass. `Cache.match`
      calls `_persistence.get`, which under `'retain'` yields the stale entry
      with the marker. `_requestMatchesCachedItem` is freshness-agnostic, so the
      entry passes through. No header-based filtering should be present in
      `cache.ts`.
- [ ] 15.2 **GREEN gate:** Re-run Section 14. All three PASS.
- [ ] 15.3 **Regression gate:** Full `deno task test`. No regressions.

## 16. Slice — `expires` metadata invariance (RED + GREEN as one slice)

Spec coverage: `cache-persistence-storage` → "Storage SHALL preserve expiration
metadata independent of eviction policy" (all three scenarios).

- [ ] 16.1 In `src/cache-persistence-memory.test.ts`, add
      `Deno.test('Memory — expires metadata invariance', ...)`:
  - `evict mode writes expires from max-age`: construct `'evict'` Memory, `put`
    with `max-age=60` and `Date: <now>`, read
    `(persistence as any)._storage[key]` (resolve key by enumerating
    `_storage`), parse the payload (uncompressed it's a `PlainReqRes` object),
    `assert(Math.abs(Number(payload.expires) - (Number(payload.created.split('-')[0]) + 60_000)) <= 50)`.
  - `retain mode writes the same expires`: same with `'retain'`; same assertion
    (independent of retention mode).
  - `no caching headers → expires equals created`: construct either mode with
    default options, `put` with `new Response('hi')`, read payload,
    `assert(Math.abs(Number(payload.expires) - Number(payload.created.split('-')[0])) <= 50)`
    (i.e. expires-minus-created is `0`, within tolerance). **This is the new
    behavior — after Section 6's `_expiresIn` cleanup, header-less responses
    have `expires === created`, NOT `created + _maxPersistenceTtlMs`.**
  - `custom maxPersistenceTtlMs does NOT affect expires for header-less responses`:
    construct with `{ maxPersistenceTtlMs: 60_000 }`, `put` with
    `new Response('hi')`, read payload,
    `assert(Math.abs(Number(payload.expires) - Number(payload.created.split('-')[0])) <= 50)`.
    The point: `maxPersistenceTtlMs` is a _storage-lifetime_ knob; `expires` is
    _HTTP freshness_ metadata. They don't mix.
- [ ] 16.2 **RED gate:** First two steps PASS as regression guards (their
      HTTP-headers cases are unchanged). Third and fourth steps FAIL on `main`
      (today they would assert `2_592_000_000` or `60_000`, not `0`). After
      Section 6 they PASS. Document the actual state when running.
- [ ] 16.3 **GREEN gate (verification only):** No production change beyond
      Section 6 expected. Re-run: all four PASS.
- [ ] 16.4 **Regression gate:** Full `deno task test`. No regressions.

## 17. Slice — Interface-signature stability (RED, anti-regression lock-in)

Spec coverage: `cache-persistence-storage` → "The CachePersistenceLike and
CacheLike interface signatures SHALL NOT change" (both scenarios).

- [ ] 17.1 In `src/cache-storage.test.ts`, add
      `Deno.test('Cache interface — no matchIncludingStale', ...)` with a step
      that opens a cache (`const cache = await caches.open('v17');`) and asserts
      `assertEquals(typeof (cache as Record<string, unknown>).matchIncludingStale, 'undefined')`.
      Clean up.
- [ ] 17.2 In the same test, add a step that asserts persistence `get` arity:
      `assertEquals((cache as any)._persistence.get.length, 2)`; call
      `(cache as any)._persistence.get('v17', new Request('http://x/'))` and
      assert the return value has `Symbol.asyncIterator` on it
      (`assertEquals(typeof gen[Symbol.asyncIterator], 'function')`). Clean up.
- [ ] 17.3 Add a TypeScript compile-time check: in a typed context,
      `// @ts-expect-error` over `cache.matchIncludingStale` access. If the type
      ever grows the property, this fails the build.
- [ ] 17.4 **RED gate:** All three steps PASS on the _intended_ end state. If
      they FAIL, the design has been compromised — fix the implementation
      (remove any accidentally-added method or signature drift) rather than the
      tests. Anti-regression lock-in.

## 18. Slice — NoOp persistence accepts both options (RED + GREEN)

Spec coverage: `cache-freshness-policy` → "The CachePersistenceNoop
implementation SHALL accept but ignore staleRetention and maxPersistenceTtlMs" +
`cache-persistence-storage` → "Storage SHALL accept maxPersistenceTtlMs as a
public option" (NoOp scenario).

- [ ] 18.1 Create `src/cache-persistence-noop.test.ts` (top-level `Deno.test`):
  - Construct two noop instances:
    `new CachePersistenceNoop({ staleRetention: 'retain', maxPersistenceTtlMs: 60_000 })`
    and
    `new CachePersistenceNoop({ staleRetention: 'evict', maxPersistenceTtlMs: 2_592_000_000 })`.
  - For each: `assertEquals(await noop.put('v18', req, res), false)`; collect
    `noop.get('v18', req)` into array; `assertEquals(arr.length, 0)`.
  - Both constructions must not throw.
- [ ] 18.2 **RED gate:** Run `deno task test`. May PASS if the noop constructor
      already accepts arbitrary options without complaint. If it FAILS (e.g. the
      option type is strict and rejects unknown fields), proceed to GREEN;
      otherwise this is a regression guard.
- [ ] 18.3 **GREEN gate:** In `src/cache-persistence-noop.ts`, ensure the
      constructor's parameter type extends `CachePersistenceBaseOptions` (or a
      superset) so both options are accepted; TSDoc documenting that
      `staleRetention` and `maxPersistenceTtlMs` are accepted but ignored
      because nothing is stored. Re-run 18.1; PASS.
- [ ] 18.4 **Regression gate:** Full `deno task test`. No regressions.

## 19. Slice — `Cache.put` overwrites stale predecessor under `'retain'` (RED + GREEN)

Spec coverage: emergent from `cache-persistence-storage` → "get() and the async
iterator SHALL yield stale entries when configured with staleRetention 'retain'"
combined with `Cache.put`'s internal dedupe behavior.

- [ ] 19.1 In `src/cache-storage.test.ts` (or in the per-persistence end-to-end
      blocks added in Section 14), add
      `Deno.test('Cache.put under retain — overwrites stale predecessor', ...)`:
  - Construct a `CacheStorage` with
    `{ staleRetention: 'retain', maxPersistenceTtlMs: 2_592_000_000 }` (Memory
    for speed under `FakeTime`).
  - `cache.put(req, resA)` where `resA` has `Cache-Control: max-age=1` and body
    `'A'`.
  - `await time.tickAsync(2000)`.
  - `cache.put(req, resB)` where `resB` has body `'B'` (fresh, e.g.
    `max-age=60`).
  - `await cache.matchAll(req)`; `assertEquals(matches.length, 1)`;
    `assertEquals(await matches[0].text(), 'B')`.
- [ ] 19.2 **RED gate:** Run `deno task test`. Should PASS after Sections 2/9
      because `Cache.put`'s internal `await this.match(request)` now finds stale
      predecessors under `'retain'`, and the existing `_persistence.delete(...)`
      call removes them before the new `put`. If FAIL, investigate the dedupe
      path in `cache.ts:put`. This slice is primarily a verification that the
      dedupe path works correctly given the new yield semantics; no `cache.ts`
      change should be needed.
- [ ] 19.3 **GREEN gate:** If RED unexpectedly FAILed, fix in `src/cache.ts`.
      Document any deviation from "no Cache layer changes".
- [ ] 19.4 **Regression gate:** Full `deno task test`. No regressions.

## 20. Documentation

- [ ] 20.1 In `README.md`, rewrite the "Key differences with the specification →
      Cache lifetimes" section. Include the two-axis framing:
  - Lead: today's default (`'evict'` + 30-day ceiling) is the library's
    pragmatic deviation from W3C. The combination of `staleRetention` and
    `maxPersistenceTtlMs` lets callers pick where on the spec-vs-pragmatism axis
    they want to be, with an explicit storage-lifetime ceiling.
  - Include the four-configuration table from `design.md` → Decision 8 verbatim
    (standard HTTP, HTTP+revalidation, pure-TTL, spec-pure).
  - **New paragraph: RFC 9111 alignment.** Document the `_expiresIn` cleanup as
    a fix: responses without `Cache-Control` and without `Expires` are no longer
    silently cached for 30 days. Per RFC 9111 §4.2.1 such responses have no
    explicit freshness lifetime; under default `'evict'` they are now evicted
    ~immediately. Recommend that callers set explicit `Cache-Control: max-age=N`
    (or `Expires`) on responses they want cached; alternatively, switch to
    `staleRetention: 'retain'` and use the `x-cachestorage-stale` header to make
    freshness decisions in application code.
  - Document the Deno KV native 30-day cap on `expireIn` as a known backend
    constraint: `maxPersistenceTtlMs` is the requested upper bound, subject to
    backend constraints.
  - Recommend pairing `'retain'` + very large `maxPersistenceTtlMs` with Redis
    `maxmemory-policy` for production.
- [ ] 20.2 Under "Additional modules" in `README.md`, add a "Stale entries and
      revalidation" subsection with a runnable Deno snippet:
  - Construct `new CachePersistenceMemory({ staleRetention: 'retain' })`.
  - Call plain W3C `cache.match(req)`.
  - Branch on `response.headers.get('x-cachestorage-stale') === '1'`.
  - On stale, demonstrate
    `fetch(req.url, { headers: { 'if-none-match': response.headers.get('etag') ?? '' } })`,
    branching on `304` to reuse the cached body.
  - Emphasize: no non-standard `Cache` method is used; plain W3C `Cache.match()`
    plus a single header check.
- [ ] 20.3 Add a second snippet under the same subsection demonstrating the
      pure-TTL pattern:
      `new CachePersistenceMemory({ staleRetention: 'retain', maxPersistenceTtlMs: 60_000 })`,
      where the application ignores `x-cachestorage-stale` and treats `match()`
      as a 60-second TTL cache regardless of `Cache-Control`.
- [ ] 20.4 In `src/types.ts`, TSDoc on
      `CachePersistenceBaseOptions.maxPersistenceTtlMs` MUST lead with:
      **"Maximum time, in milliseconds, that an entry may remain in persistence.
      Universal upper bound applied in every `staleRetention` mode. This is
      _storage policy, not HTTP freshness_ — it is distinct from
      `Cache-Control: max-age` and `Expires:` and is not affected by them. Use
      this option to bound how long entries _can_ live in persistence; use
      `Cache-Control` on responses to control how long they _should be
      considered fresh_."** Include the per-mode formulas
      (`min(httpExpiresIn, maxPersistenceTtlMs)` under `'evict'`;
      `maxPersistenceTtlMs` under `'retain'`), the explicit-`Ms`-suffix
      rationale (avoids the seconds-vs-milliseconds footgun common in
      Redis/DNS/CDN TTL conventions), and the Deno KV backend-cap note ("Deno
      KV's native 30-day `expireIn` cap is a backend constraint on
      `maxPersistenceTtlMs` values exceeding it"). `@default 2_592_000_000` (30
      days).
- [ ] 20.5 TSDoc on `CachePersistenceBaseOptions.staleRetention` MUST
      cross-reference `maxPersistenceTtlMs` ("This option works in conjunction
      with `maxPersistenceTtlMs` to determine when entries are evicted from
      storage; see `maxPersistenceTtlMs` for the universal ceiling that applies
      in both modes").
- [ ] 20.6 Update TSDoc on `_expiresIn(response)` in
      `src/cache-persistence-base.ts` to document its post-cleanup contract:
      "Returns the HTTP freshness lifetime of the response in milliseconds, per
      RFC 9111 §4.2.1. Returns `Math.round(msLeft)` for responses with
      `Cache-Control: max-age` / `s-maxage` or `Expires`. Returns `0` for
      responses with neither — such responses have no explicit freshness
      lifetime per the RFC. This method represents pure HTTP semantics: it does
      NOT clamp at `_maxPersistenceTtlMs`. Storage-lifetime clamping is the
      responsibility of `_evictionDelay()`."
- [ ] 20.7 Add a `CHANGELOG.md` entry. Two sections — the option additions are
      "Added", the `_expiresIn` cleanup is "Fixed":
  - **Added:** "`staleRetention` (`'evict' | 'retain'`) and
    `maxPersistenceTtlMs` (number, default 30 days) options on bundled
    persistence implementations. `staleRetention: 'retain'` makes the cache
    W3C-spec compliant: entries persist as stale (signalled via
    `x-cachestorage-stale` header) until `maxPersistenceTtlMs` elapses.
    `maxPersistenceTtlMs` is a universal upper bound on entry storage lifetime,
    applied in both modes. Deno KV's native 30-day `expireIn` cap is a known
    backend constraint."
  - **Fixed (BREAKING):** "Responses without `Cache-Control` and without
    `Expires` are no longer silently cached for 30 days. The previous behavior
    was an undocumented heuristic-freshness policy that violated RFC 9111 §4.2.1
    (which says such responses have no explicit freshness lifetime). Under
    default `staleRetention: 'evict'` they are now evicted ~immediately; under
    `staleRetention: 'retain'` they are immediately stale (marker header set)
    but retained for `maxPersistenceTtlMs`. **Migration:** set explicit
    `Cache-Control: max-age=N` on responses you want cached for `N` seconds, or
    use `staleRetention: 'retain'` and consult the `x-cachestorage-stale` header
    in application code."

## 21. Final verification

- [ ] 21.1 Run `deno task test` — full suite passes.
- [ ] 21.2 Run `deno task test:ci` — passes (sanity check the Redis-excluded
      variant).
- [ ] 21.3 Run `deno task bench` for Memory under all four canonical
      configurations (the table in `design.md` → Decision 8); capture results;
      confirm `'retain'` is not meaningfully slower than `'evict'` for
      `put`/`get` on fresh entries, and that custom `maxPersistenceTtlMs` is not
      meaningfully slower than default.
- [ ] 21.4 Run `openspec validate separate-expired-from-evicted --strict` —
      clean.
- [ ] 21.5 Audit the git history of this change: every behavior-changing commit
      MUST have a preceding (or co-located, see DoD) commit that adds the
      failing test. Where a single commit contains both, the commit message MUST
      state "RED→GREEN" and reference the spec scenario. The Section 6
      audit-and-update commit MUST list each rewritten/deleted test by name and
      Category (A/B/C).

## Definition of Done

- [ ] Every behavior change has a corresponding test written _before_ its
      implementation. Verify via git history: for each behavior-changing commit,
      an earlier (or co-located) commit adds the failing test.
- [ ] Every RED test was observed to fail against the pre-implementation code,
      and was observed to pass after. Regression-guard tests (preserving today's
      `'evict'` + default `maxPersistenceTtlMs` behavior _for responses with
      explicit HTTP expiration headers_) were observed to PASS throughout and
      are clearly labelled "regression guard" in commit messages.
- [ ] Full test suite passes: `deno task test` (and `deno task test:ci`).
- [ ] `openspec validate separate-expired-from-evicted --strict` exits cleanly.
- [ ] Every `#### Scenario:` in `specs/cache-persistence-storage/spec.md` and
      `specs/cache-freshness-policy/spec.md` maps to at least one test
      (traceable by scenario name in test step names or comments).
- [ ] No production code is present that is not exercised by a test added or
      already present in this change. Verified via `deno task coverage` —
      confirm the diff in `src/` against `main` is fully covered (excluding
      `src/test-utils.ts` per existing `coverage` task config).
- [ ] `README.md` updated per Section 20.1, 20.2, 20.3. The README explicitly
      documents the header-less-response behavior change as RFC 9111 alignment
      with migration guidance.
- [ ] `CHANGELOG.md` updated per Section 20.7. The Fixed/BREAKING entry for the
      header-less-response behavior change is present and includes migration
      guidance.
- [ ] `_expiresIn()` is pure HTTP semantics: a `grep` of
      `cache-persistence-base.ts` for `_maxPersistenceTtlMs` references inside
      the `_expiresIn` function body returns zero matches. All
      `_maxPersistenceTtlMs` references in that file are in `_evictionDelay`,
      the constructor, or as the protected-field initializer.
- [ ] `maxPersistenceTtlMs` is documented with the universal-ceiling framing in
      TSDoc (Section 20.4) AND in the README (Section 20.1). Both make explicit
      that it applies in all `staleRetention` modes and is distinct from HTTP
      `Expires:` / `Cache-Control` freshness semantics.
- [ ] `_expiresIn()` is documented with the pure-HTTP-semantics framing in TSDoc
      (Section 20.6), referencing RFC 9111 §4.2.1.
- [ ] Deno KV's native 30-day backend cap on `expireIn` is documented as a known
      constraint on `maxPersistenceTtlMs` values exceeding it, in both TSDoc
      (Section 20.4) and the README (Section 20.1).
- [ ] The four-configuration table from `design.md` → Decision 8 is present in
      the README (Section 20.1).
- [ ] No new method on `CacheLike`; no signature change on
      `CachePersistenceLike.get` or `[Symbol.asyncIterator]` — locked in by
      Section 17.
- [ ] Subclasses of `CachePersistenceBase` that override the protected
      `_maxPersistenceTtlMs` field in their own constructor continue to work
      without code changes — verified by code inspection of the base constructor
      logic implemented in Section 4.2.
- [ ] The Section 6 audit categorizes every previously-failing test in
      `src/cache-storage.test.ts` into Category A (incidental, update headers),
      B (intentional 30-day-fallback bug, delete or rewrite), or C (testing
      different concern, update headers). The audit's Category B list is
      documented in the audit commit message as the canonical evidence that the
      prior behavior was bug-grade.

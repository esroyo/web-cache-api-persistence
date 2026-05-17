import { assert, assertEquals } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import { CachePersistenceMemory } from "./mod.ts";
import { CacheStorage } from "../core/cache_storage.ts";
import { runSharedTests } from "../_shared/cache_storage_test.ts";
import type {
  CacheLike,
  CachePersistenceMemoryOptions,
} from "../core/types.ts";

/**
 * Build a fresh `CacheStorage` whose backing persistence is a
 * `CachePersistenceMemory` configured per call.
 *
 * The behavioral tests below observe configuration solely through the
 * W3C-style `Cache` surface (`put` / `match` / `matchAll`) plus the
 * `x-cachestorage-stale` response header. They never read persistence
 * internals (`_storage`, `_timers`, `_maxPersistenceTtlMs`, …) and never
 * spy on the eviction primitive (`setTimeout`). The only knobs are the
 * constructor options; the only outputs are what the public API hands back.
 */
function createStorage(
  options?: CachePersistenceMemoryOptions,
): CacheStorage {
  return new CacheStorage({
    create: async () => new CachePersistenceMemory(options),
  });
}

let cacheCounter = 0;
function nextCacheName(): string {
  return `memory-test-${++cacheCounter}`;
}

/**
 * Open a unique-named cache against a freshly-configured Memory storage
 * and wrap its `Symbol.asyncDispose` to also call `storage.delete(name)`
 * on tear-down. With this wrapping, every step can use the same
 * `await using cache = await createCache(options)` shape across all four
 * backends — the helper hides cleanup details (eviction-timer drainage on
 * Memory; pool drainage + cache-name removal on KV/Redis; no-op on Noop)
 * inside the disposable.
 */
async function createCache(
  options?: CachePersistenceMemoryOptions,
): Promise<CacheLike> {
  const storage = createStorage(options);
  const name = nextCacheName();
  const cache = (await storage.open(name)) as CacheLike;
  const originalDispose = cache[Symbol.asyncDispose].bind(cache);
  cache[Symbol.asyncDispose] = async () => {
    try {
      await storage.delete(name);
    } finally {
      await originalDispose();
    }
  };
  return cache;
}

function createFreshResponse(
  body: string,
  init?: { cacheControl?: string; extraHeaders?: Record<string, string> },
): Response {
  const headers: Record<string, string> = {
    date: new Date(Date.now()).toUTCString(),
    ...(init?.cacheControl ? { "cache-control": init.cacheControl } : {}),
    ...(init?.extraHeaders ?? {}),
  };
  return new Response(body, { headers });
}

Deno.test("Memory — staleRetention=evict (default)", async (t) => {
  await t.step(
    "an entry past its HTTP expiration is no longer matched",
    async () => {
      using time = new FakeTime();
      await using cache = await createCache();
      const req = new Request("http://localhost/x");
      await cache.put(
        req,
        createFreshResponse("hello", { cacheControl: "max-age=1" }),
      );

      // Fresh window: entry is matched, no stale marker.
      const fresh = await cache.match(req);
      assert(fresh !== undefined, "expected fresh match");
      assertEquals(await fresh.text(), "hello");
      assertEquals(fresh.headers.get("x-cachestorage-stale"), null);

      // Past HTTP expiration under evict: gone.
      await time.tickAsync(2_000);
      assertEquals(await cache.match(req), undefined);
    },
  );

  await t.step(
    "a response without explicit freshness is not stored",
    async () => {
      await using cache = await createCache();
      const req = new Request("http://localhost/x");
      // No Cache-Control, no Expires — RFC 9111 §4.2.1: no explicit
      // freshness lifetime. Under default `evict` this means "don't
      // store"; the entry must not be observable.
      await cache.put(req, new Response("hi"));
      assertEquals(await cache.match(req), undefined);
      assertEquals((await cache.matchAll(req)).length, 0);
    },
  );

  await t.step(
    "maxPersistenceTtlMs caps storage lifetime below HTTP expiration",
    async () => {
      using time = new FakeTime();
      // HTTP says "fresh for 1 hour" but storage policy says "max 60s".
      // The cap must win: the entry must be gone at t > 60s even
      // though HTTP still considers it fresh.
      await using cache = await createCache({
        maxPersistenceTtlMs: 60_000,
      });
      const req = new Request("http://localhost/x");
      await cache.put(
        req,
        createFreshResponse("hello", { cacheControl: "max-age=3600" }),
      );

      // Within the cap: still matched.
      await time.tickAsync(30_000);
      const mid = await cache.match(req);
      assert(mid !== undefined, "expected match before cap");
      assertEquals(await mid.text(), "hello");

      // Past the cap: gone.
      await time.tickAsync(31_000);
      assertEquals(await cache.match(req), undefined);
    },
  );

  await t.step(
    "maxPersistenceTtlMs does not extend HTTP expiration",
    async () => {
      using time = new FakeTime();
      // HTTP says "fresh for 30s"; the cap is well above that. HTTP
      // expiration should still win — entry gone at t > 30s.
      await using cache = await createCache({
        maxPersistenceTtlMs: 60_000,
      });
      const req = new Request("http://localhost/x");
      await cache.put(
        req,
        createFreshResponse("hello", { cacheControl: "max-age=30" }),
      );

      await time.tickAsync(31_000);
      assertEquals(await cache.match(req), undefined);
    },
  );
});

Deno.test("Memory — staleRetention=retain", async (t) => {
  await t.step(
    "an entry past HTTP expiration is still matched, with stale marker",
    async () => {
      using time = new FakeTime();
      await using cache = await createCache({
        staleRetention: "retain",
        maxPersistenceTtlMs: 60_000,
      });
      const req = new Request("http://localhost/x");
      await cache.put(
        req,
        createFreshResponse("hello", { cacheControl: "max-age=1" }),
      );

      // Fresh window: matched, NO stale marker.
      const fresh = await cache.match(req);
      assert(fresh !== undefined, "expected fresh match");
      assertEquals(fresh.headers.get("x-cachestorage-stale"), null);

      // Past HTTP expiration: still matched, marked stale.
      await time.tickAsync(2_000);
      const stale = await cache.match(req);
      assert(stale !== undefined, "expected stale match under retain");
      assertEquals(await stale.text(), "hello");
      assertEquals(stale.headers.get("x-cachestorage-stale"), "1");
    },
  );

  await t.step(
    "a header-less response is stored, and stale on first read",
    async () => {
      await using cache = await createCache({
        staleRetention: "retain",
        maxPersistenceTtlMs: 60_000,
      });
      const req = new Request("http://localhost/x");
      await cache.put(req, new Response("hi"));

      const matched = await cache.match(req);
      assert(matched !== undefined, "expected match under retain");
      assertEquals(await matched.text(), "hi");
      assertEquals(matched.headers.get("x-cachestorage-stale"), "1");
    },
  );

  await t.step(
    "maxPersistenceTtlMs bounds the lifetime of a stale entry",
    async () => {
      using time = new FakeTime();
      await using cache = await createCache({
        staleRetention: "retain",
        maxPersistenceTtlMs: 60_000,
      });
      const req = new Request("http://localhost/x");
      await cache.put(
        req,
        createFreshResponse("hello", { cacheControl: "max-age=1" }),
      );

      // Well past HTTP expiration, well within the cap: still served
      // as stale.
      await time.tickAsync(30_000);
      const stale = await cache.match(req);
      assert(stale !== undefined, "expected stale match within cap");
      assertEquals(stale.headers.get("x-cachestorage-stale"), "1");

      // Past the cap: gone (storage-policy ceiling).
      await time.tickAsync(31_000);
      assertEquals(await cache.match(req), undefined);
    },
  );

  await t.step(
    "a fresh put overwrites a stale predecessor for the same request",
    async () => {
      using time = new FakeTime();
      await using cache = await createCache({
        staleRetention: "retain",
        maxPersistenceTtlMs: 60_000,
      });
      const req = new Request("http://localhost/x");

      await cache.put(
        req,
        createFreshResponse("A", { cacheControl: "max-age=1" }),
      );
      await time.tickAsync(2_000);
      // Predecessor is now stale (but still retained). New put should
      // replace it, not pile up alongside.
      await cache.put(
        req,
        createFreshResponse("B", { cacheControl: "max-age=60" }),
      );

      const matches = await cache.matchAll(req);
      assertEquals(matches.length, 1);
      assertEquals(await matches[0].text(), "B");
      // The replacement is fresh.
      assertEquals(matches[0].headers.get("x-cachestorage-stale"), null);
    },
  );
});

import memoryDefault, { memory } from "./mod.ts";

Deno.test("memory factory", async (t) => {
  await t.step("default and named exports are identity-equal", () => {
    assertEquals(memoryDefault, memory);
  });

  await t.step(
    "factory.create() returns CachePersistenceMemory",
    async () => {
      const factory = memory();
      const instance = await factory.create();
      assert(instance instanceof CachePersistenceMemory);
    },
  );

  await t.step("options pass through to the instance", async () => {
    const factory = memory({ maxPersistenceTtlMs: 60_000 });
    const instance = await factory.create();
    assertEquals(
      (instance as unknown as { _maxPersistenceTtlMs: number })
        ._maxPersistenceTtlMs,
      60_000,
    );
  });

  await t.step("no memoization across create() calls", async () => {
    const factory = memory();
    const a = await factory.create();
    const b = await factory.create();
    assert(a !== b);
  });

  await t.step("no state shared across factory-function calls", () => {
    const fA = memory();
    const fB = memory();
    assert(fA !== fB);
  });

  await t.step("does not mutate the options argument", async () => {
    const opts = {
      maxPersistenceTtlMs: 60_000,
      staleRetention: "retain" as const,
    };
    const snapshot = { ...opts };
    await memory(opts).create();
    assertEquals(opts, snapshot);
  });
});

runSharedTests(
  "memory",
  new CacheStorage(
    undefined,
    (name, value) => (name === "user-agent" ? "firefox" : value),
  ),
);

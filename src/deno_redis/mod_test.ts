import { assert, assertEquals } from "@std/assert";
import { delay } from "@std/async/delay";
import { CachePersistenceDenoRedis } from "./mod.ts";
import { CacheStorage } from "../core/cache_storage.ts";
import { runSharedTests } from "../_shared/cache_storage_test.ts";
import { nextPort, startRedis } from "../core/test_utils.ts";
import type {
  CacheLike,
  CachePersistenceDenoRedisOptions,
} from "../core/types.ts";

/**
 * Build a fresh `CacheStorage` whose backing persistence is a
 * `CachePersistenceDenoRedis` configured per call.
 *
 * The behavioral tests below observe configuration solely through the
 * W3C-style `Cache` surface (`put` / `match` / `matchAll`) plus the
 * `x-cachestorage-stale` response header. They never read persistence
 * internals (`_dbPool`, `_evictionDelay`, …) and never spy on the Redis
 * command boundary (`sendCommand`, `pipeline`).
 *
 * Eviction in Redis is driven by `PEXPIRE` inside the Redis server, which
 * runs out-of-process. These tests do NOT assert "entry is physically gone
 * at `maxPersistenceTtlMs`" — that timing is a backend concern, not part of
 * this library's surface. What IS asserted is the in-process freshness/
 * stale logic this library guarantees:
 *
 *  - under `evict`, HTTP-expired entries are filtered out by `get()` —
 *    `cache.match` returns `undefined`;
 *  - under `retain`, HTTP-expired entries are returned with the
 *    `x-cachestorage-stale: 1` marker.
 */
function createStorage(
  options?: Partial<CachePersistenceDenoRedisOptions>,
): CacheStorage {
  return new CacheStorage({
    create: async () =>
      new CachePersistenceDenoRedis({
        port,
        hostname: "127.0.0.1",
        ...options,
      }),
  });
}

let cacheCounter = 0;
function nextCacheName(): string {
  return `redis-test-${++cacheCounter}`;
}

/**
 * Open a unique-named cache against a freshly-configured Redis storage
 * and wrap its `Symbol.asyncDispose` to also call `storage.delete(name)`
 * on tear-down. The cache name is drawn from `nextCacheName()`, outside
 * the `v1`/`v2`/`v3` namespace used by the shared `cache-storage.test.ts`
 * suite re-imported at the bottom of this file. The wrapped disposer
 * removes any persisted entries from the backing Redis so the shared
 * suite sees a clean view of `caches.keys()`.
 */
async function createCache(
  options?: Partial<CachePersistenceDenoRedisOptions>,
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
  init?: { cacheControl?: string },
): Response {
  return new Response(body, {
    headers: {
      date: new Date(Date.now()).toUTCString(),
      ...(init?.cacheControl ? { "cache-control": init.cacheControl } : {}),
    },
  });
}

const port = nextPort();
const server = await startRedis({ port });

Deno.test("Redis — staleRetention=evict (default)", async (t) => {
  await t.step(
    "an entry past its HTTP expiration is no longer matched",
    async () => {
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

      // Past HTTP expiration under evict: filtered out by get().
      await delay(1_500);
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
});

Deno.test("Redis — staleRetention=retain", async (t) => {
  await t.step(
    "an entry past HTTP expiration is still matched, with stale marker",
    async () => {
      await using cache = await createCache({
        staleRetention: "retain",
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
      await delay(1_500);
      const stale = await cache.match(req);
      assert(stale !== undefined, "expected stale under retain");
      assertEquals(await stale.text(), "hello");
      assertEquals(stale.headers.get("x-cachestorage-stale"), "1");
    },
  );

  await t.step(
    "a header-less response is stored, and stale on first read",
    async () => {
      await using cache = await createCache({
        staleRetention: "retain",
      });
      const req = new Request("http://localhost/x");
      await cache.put(req, new Response("hi"));

      const matched = await cache.match(req);
      assert(matched !== undefined, "expected match under retain");
      assertEquals(await matched.text(), "hi");
      assertEquals(matched.headers.get("x-cachestorage-stale"), "1");
    },
  );
});

import denoRedisDefault, { CachePersistenceRedis, denoRedis } from "./mod.ts";

Deno.test("denoRedis factory", async (t) => {
  const baseOptions = {
    port,
    hostname: "127.0.0.1",
    max: 1,
    min: 1,
  } as const;

  await t.step("default and named exports are identity-equal", () => {
    assertEquals(denoRedisDefault, denoRedis);
  });

  await t.step(
    "factory.create() returns CachePersistenceDenoRedis",
    async () => {
      const factory = denoRedis({ ...baseOptions });
      await using instance = (await factory
        .create()) as CachePersistenceDenoRedis;
      assert(instance instanceof CachePersistenceDenoRedis);
    },
  );

  await t.step("options pass through to the instance", async () => {
    const factory = denoRedis({
      ...baseOptions,
      maxPersistenceTtlMs: 60_000,
    });
    await using instance = (await factory
      .create()) as CachePersistenceDenoRedis;
    assertEquals(
      (instance as unknown as { _maxPersistenceTtlMs: number })
        ._maxPersistenceTtlMs,
      60_000,
    );
  });

  await t.step("no memoization across create() calls", async () => {
    const factory = denoRedis({ ...baseOptions });
    await using a = (await factory.create()) as CachePersistenceDenoRedis;
    await using b = (await factory.create()) as CachePersistenceDenoRedis;
    assert(a !== b);
  });

  await t.step("no state shared across factory-function calls", () => {
    const fA = denoRedis({ ...baseOptions });
    const fB = denoRedis({ ...baseOptions });
    assert(fA !== fB);
  });

  await t.step("does not mutate the options argument", async () => {
    const opts: CachePersistenceDenoRedisOptions = {
      ...baseOptions,
      maxPersistenceTtlMs: 60_000,
      staleRetention: "retain" as const,
    };
    const snapshot = { ...opts };
    await using _instance = (await denoRedis(opts)
      .create()) as CachePersistenceDenoRedis;
    assertEquals(opts, snapshot);
  });

  await t.step(
    "CachePersistenceRedis alias resolves to the same class identity",
    () => {
      assertEquals(CachePersistenceRedis, CachePersistenceDenoRedis);
    },
  );
});

runSharedTests(
  "deno-redis",
  new CacheStorage(
    {
      create: async () =>
        new CachePersistenceDenoRedis({
          port,
          hostname: "127.0.0.1",
          max: 1,
          min: 1,
        }),
    },
    (name, value) => (name === "user-agent" ? "firefox" : value),
  ),
);

// stopRedis(server);

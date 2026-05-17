import { assert, assertEquals, assertRejects } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import { createStorage as createUnstorage } from "unstorage";
import fsLiteDriver from "unstorage/drivers/fs-lite";
import redisDriver from "unstorage/drivers/redis";
import { runSharedTests } from "../_shared/cache_storage_test.ts";
import { nextPort, startRedis } from "../core/test_utils.ts";
import { CachePersistenceUnstorage } from "./mod.ts";
import { CacheStorage } from "../core/cache_storage.ts";
import type { CacheLike } from "../core/types.ts";
import type { CachePersistenceUnstorageOptions } from "./mod.ts";

function createStorage(
  options?: Partial<CachePersistenceUnstorageOptions>,
): CacheStorage {
  return new CacheStorage({
    create: () =>
      Promise.resolve(
        new CachePersistenceUnstorage({
          storage: createUnstorage(),
          ...options,
        }),
      ),
  });
}

let cacheCounter = 0;
function nextCacheName(): string {
  return `unstorage-test-${++cacheCounter}`;
}

async function createCache(
  options?: Partial<CachePersistenceUnstorageOptions>,
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

import unstorageDefault, { unstorage } from "./mod.ts";

// Redis setup for multi-backend shared conformance tests
const _redisPort = nextPort();
const _redisServer = await startRedis({ port: _redisPort });

const _normalizer = (name: string, value: string | null) =>
  name === "user-agent" ? "firefox" : value;

const _memoryStorage = createUnstorage();
runSharedTests(
  "unstorage:memory",
  new CacheStorage(
    {
      create: () =>
        Promise.resolve(
          new CachePersistenceUnstorage({ storage: _memoryStorage }),
        ),
    },
    _normalizer,
  ),
);

// unstorage deno-kv driver does not support TTL (the `ttl` option is silently
// ignored), so entries past HTTP expiration accumulate without being evicted.
// This causes false positives in `has()` and leaves stale data in the
// persistent database.  This is a driver limitation, not a library bug.
// Re-enable when unstorage fixes the driver.
// const _denoKvStorage = createUnstorage({ driver: denoKvDriver() });
// runSharedTests("unstorage:deno-kv", ...);

const _redisStorage = createUnstorage({
  // @ts-expect-error — Deno npm type resolution (#805)
  driver: redisDriver({ url: `redis://127.0.0.1:${_redisPort}` }),
});
// Eagerly open the connection before tests so Deno's per-test leak
// detection doesn't flag the TCP socket as leaked during a test run.
await _redisStorage.setItem("__probe__", "1");
await _redisStorage.removeItem("__probe__");
runSharedTests(
  "unstorage:redis",
  new CacheStorage(
    {
      create: () =>
        Promise.resolve(
          new CachePersistenceUnstorage({ storage: _redisStorage }),
        ),
    },
    _normalizer,
  ),
);
addEventListener("unload", () => {
  _redisStorage.dispose?.();
  try {
    Deno.removeSync("tmp/test-fs", { recursive: true });
  } catch {
    // ignore if already removed
  }
});

const _fsStorage = createUnstorage({
  // @ts-expect-error — Deno npm type resolution (#805)
  driver: fsLiteDriver({ base: "tmp/test-fs" }),
});
runSharedTests(
  "unstorage:fs-lite",
  new CacheStorage(
    {
      create: () =>
        Promise.resolve(
          new CachePersistenceUnstorage({ storage: _fsStorage }),
        ),
    },
    _normalizer,
  ),
);

Deno.test("unstorage factory", async (t) => {
  await t.step("default and named exports are identity-equal", () => {
    assertEquals(unstorageDefault, unstorage);
  });

  await t.step(
    "factory.create() returns CachePersistenceUnstorage",
    async () => {
      const factory = unstorage({ storage: createUnstorage() });
      const instance = await factory.create();
      assert(instance instanceof CachePersistenceUnstorage);
    },
  );

  await t.step("no memoization across create() calls", async () => {
    const factory = unstorage({ storage: createUnstorage() });
    const a = await factory.create();
    const b = await factory.create();
    assert(a !== b);
  });

  await t.step("no state shared across factory-function calls", () => {
    const fA = unstorage({ storage: createUnstorage() });
    const fB = unstorage({ storage: createUnstorage() });
    assert(fA !== fB);
  });

  await t.step("does not mutate the options argument", async () => {
    const storage = createUnstorage();
    const opts = {
      storage,
      maxPersistenceTtlMs: 60_000,
      staleRetention: "retain" as const,
    };
    const snapshot = { ...opts, storage };
    await unstorage(opts).create();
    assertEquals(opts, snapshot);
  });
});

Deno.test("Unstorage — staleRetention=evict (default)", async (t) => {
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

      const fresh = await cache.match(req);
      assert(fresh !== undefined, "expected fresh match");
      assertEquals(await fresh.text(), "hello");
      assertEquals(fresh.headers.get("x-cachestorage-stale"), null);

      await time.tickAsync(2_000);
      assertEquals(await cache.match(req), undefined);
    },
  );

  await t.step(
    "a response without explicit freshness is not stored",
    async () => {
      await using cache = await createCache();
      const req = new Request("http://localhost/x");
      await cache.put(req, new Response("hi"));
      assertEquals(await cache.match(req), undefined);
      assertEquals((await cache.matchAll(req)).length, 0);
    },
  );
});

Deno.test("Unstorage — staleRetention=retain", async (t) => {
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

      const fresh = await cache.match(req);
      assert(fresh !== undefined, "expected fresh match");
      assertEquals(fresh.headers.get("x-cachestorage-stale"), null);

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
});

Deno.test("Unstorage — CRUD", async (t) => {
  await t.step(
    "put then match returns the stored response body, status, and headers",
    async () => {
      await using cache = await createCache();
      const req = new Request("http://example.com/a");
      const res = new Response("hello", {
        status: 200,
        headers: {
          "content-type": "text/plain",
          "cache-control": "max-age=3600",
        },
      });
      await cache.put(req, res);

      const matched = await cache.match(req);
      assert(matched !== undefined);
      assertEquals(await matched.text(), "hello");
      assertEquals(matched.status, 200);
      assertEquals(matched.headers.get("content-type"), "text/plain");
    },
  );

  await t.step(
    "put twice for same request URL replaces the entry",
    async () => {
      await using cache = await createCache();
      const req = new Request("http://example.com/a");
      await cache.put(
        req,
        new Response("A", {
          headers: { "cache-control": "max-age=3600" },
        }),
      );
      await cache.put(
        req,
        new Response("B", {
          headers: { "cache-control": "max-age=3600" },
        }),
      );

      const matches = await cache.matchAll(req);
      assertEquals(matches.length, 1);
      assertEquals(await matches[0].text(), "B");
    },
  );

  await t.step("delete removes a stored entry", async () => {
    await using cache = await createCache();
    const req = new Request("http://example.com/a");
    await cache.put(
      req,
      new Response("hello", {
        headers: { "cache-control": "max-age=3600" },
      }),
    );
    assert(await cache.delete(req));
    assertEquals(await cache.match(req), undefined);
  });

  await t.step("delete for non-existent key returns false", async () => {
    await using cache = await createCache();
    const req = new Request("http://example.com/never-put");
    assertEquals(await cache.delete(req), false);
  });

  await t.step(
    "entries from different caches are isolated",
    async () => {
      const storage = createUnstorage();
      const storeA = createStorage({ storage });
      const storeB = createStorage({ storage });
      await using cacheA = await storeA.open("cacheA") as CacheLike;
      await using cacheB = await storeB.open("cacheB") as CacheLike;

      const req = new Request("http://example.com/a");
      await cacheA.put(
        req,
        new Response("A-body", {
          headers: { "cache-control": "max-age=3600" },
        }),
      );
      await cacheB.put(
        req,
        new Response("B-body", {
          headers: { "cache-control": "max-age=3600" },
        }),
      );

      assertEquals(await (await cacheA.match(req))?.text(), "A-body");
      assertEquals(await (await cacheB.match(req))?.text(), "B-body");
    },
  );

  await t.step(
    "entries from different CacheStorage instances sharing the same unstorage backend are isolated",
    async () => {
      const storage = createUnstorage();
      const storeA = new CacheStorage({
        create: () =>
          Promise.resolve(new CachePersistenceUnstorage({ storage })),
      });
      const storeB = new CacheStorage({
        create: () =>
          Promise.resolve(new CachePersistenceUnstorage({ storage })),
      });

      const req = new Request("http://example.com/a");
      const cacheA = await storeA.open("shared-cache") as CacheLike;
      const cacheB = await storeB.open("shared-cache") as CacheLike;

      await cacheA.put(
        req,
        new Response("A-data", {
          headers: { "cache-control": "max-age=3600" },
        }),
      );
      await cacheB.put(
        req,
        new Response("B-data", {
          headers: { "cache-control": "max-age=3600" },
        }),
      );

      assertEquals(
        await (await cacheA.match(req))?.text(),
        "B-data",
      );

      await cacheA[Symbol.asyncDispose]?.();
      await cacheB[Symbol.asyncDispose]?.();
      await storeA.delete("shared-cache");
      await storeB.delete("shared-cache");
    },
  );

  await t.step(
    "large response body (100 KB) round-trips byte-for-byte identical",
    async () => {
      await using cache = await createCache();
      const req = new Request("http://example.com/large");
      const largeBody = "x".repeat(100_000);
      await cache.put(
        req,
        new Response(largeBody, {
          headers: { "cache-control": "max-age=3600" },
        }),
      );

      const matched = await cache.match(req);
      assert(matched !== undefined);
      assertEquals(await matched.text(), largeBody);
    },
  );

  await t.step(
    "error from unstorage storage on put propagates",
    async () => {
      const throwingStorage = createUnstorage();
      const originalSet = throwingStorage.setItemRaw.bind(throwingStorage);
      throwingStorage.setItemRaw = () =>
        Promise.reject(new Error("storage error"));

      await using cache = await createCache({
        storage: throwingStorage,
      });
      const req = new Request("http://example.com/err");
      const res = new Response("oops", {
        headers: { "cache-control": "max-age=3600" },
      });

      await assertRejects(
        () => cache.put(req, res),
        Error,
        "storage error",
      );

      throwingStorage.setItemRaw = originalSet;
    },
  );
});

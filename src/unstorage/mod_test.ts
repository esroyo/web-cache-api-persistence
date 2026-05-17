import { assert, assertEquals, assertRejects } from "@std/assert";
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

import unstorageDefault, { unstorage } from "./mod.ts";

// Redis setup for multi-backend shared conformance tests
const _redisPort = nextPort();
const _redisServer = await startRedis({ port: _redisPort });

const _normalizer = (name: string, value: string | null) =>
  name === "user-agent" ? "firefox" : value;

const _memoryStorage = createUnstorage();
runSharedTests(
  "unstorage:memory:evict",
  new CacheStorage(
    {
      create: () =>
        Promise.resolve(
          new CachePersistenceUnstorage({ storage: _memoryStorage }),
        ),
    },
    _normalizer,
  ),
  { staleRetention: "evict" },
);

runSharedTests(
  "unstorage:memory:retain",
  new CacheStorage(
    {
      create: () =>
        Promise.resolve(
          new CachePersistenceUnstorage({
            storage: _memoryStorage,
            staleRetention: "retain",
          }),
        ),
    },
    _normalizer,
  ),
  { staleRetention: "retain" },
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
  "unstorage:redis:evict",
  new CacheStorage(
    {
      create: () =>
        Promise.resolve(
          new CachePersistenceUnstorage({ storage: _redisStorage }),
        ),
    },
    _normalizer,
  ),
  { staleRetention: "evict" },
);

runSharedTests(
  "unstorage:redis:retain",
  new CacheStorage(
    (() => {
      let persistence;
      return {
        async create() {
          persistence ??= new CachePersistenceUnstorage({
            storage: _redisStorage,
            staleRetention: "retain",
          });
          return persistence;
        },
      };
    })(),
    _normalizer,
  ),
  { staleRetention: "retain" },
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
  "unstorage:fs-lite:evict",
  new CacheStorage(
    {
      create: () =>
        Promise.resolve(
          new CachePersistenceUnstorage({ storage: _fsStorage }),
        ),
    },
    _normalizer,
  ),
  { staleRetention: "evict" },
);

runSharedTests(
  "unstorage:fs-lite:retain",
  new CacheStorage(
    (() => {
      let persistence;
      return {
        async create() {
          persistence ??= new CachePersistenceUnstorage({
            storage: _fsStorage,
            staleRetention: "retain",
          });
          return persistence;
        },
      };
    })(),
    _normalizer,
  ),
  { staleRetention: "retain" },
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

Deno.test("Unstorage — error propagation", async () => {
  const throwingStorage = createUnstorage();
  const originalSet = throwingStorage.setItemRaw.bind(throwingStorage);
  throwingStorage.setItemRaw = () => Promise.reject(new Error("storage error"));

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
});

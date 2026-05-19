import { assert, assertEquals, assertRejects } from "@std/assert";
import { createStorage as createUnstorage } from "unstorage";
import fsLiteDriver from "unstorage/drivers/fs-lite";
import redisDriver from "unstorage/drivers/redis";
import denoKvDriver from "unstorage/drivers/deno-kv";
import memoryDriver from "unstorage/drivers/lru-cache";
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

{
  const opts = { staleRetention: "evict" as const };
  await using instance = new CachePersistenceUnstorage({
    ...opts,
    storage: createUnstorage({ driver: memoryDriver({}) }),
  });
  const originalDispose = instance[Symbol.asyncDispose];
  // @ts-ignore
  instance[Symbol.asyncDispose] = undefined;
  await runSharedTests(
    "unstorage:memory:evict",
    Object.assign(
      new CacheStorage({
        create: async () => instance,
      }, _normalizer),
      { [Symbol.asyncDispose]: originalDispose },
    ),
    opts,
  );
}

{
  const opts = { staleRetention: "retain" as const };
  await using instance = new CachePersistenceUnstorage({
    ...opts,
    storage: createUnstorage({ driver: memoryDriver({}) }),
  });
  const originalDispose = instance[Symbol.asyncDispose];
  // @ts-ignore
  instance[Symbol.asyncDispose] = undefined;
  await runSharedTests(
    "unstorage:memory:retain",
    Object.assign(
      new CacheStorage({
        create: async () => instance,
      }, _normalizer),
      { [Symbol.asyncDispose]: originalDispose },
    ),
    opts,
  );
}

{
  const opts = { staleRetention: "evict" as const };
  runSharedTests(
    "unstorage:deno-kv:evict",
    new CacheStorage({
      create: async () =>
        new CachePersistenceUnstorage({
          ...opts,
          storage: createUnstorage({
            driver: denoKvDriver({}),
          }),
        }),
    }, _normalizer),
    opts,
  );
}

{
  const opts = { staleRetention: "retain" as const };
  runSharedTests(
    "unstorage:deno-kv:retain",
    new CacheStorage({
      create: async () =>
        new CachePersistenceUnstorage({
          ...opts,
          storage: createUnstorage({
            driver: denoKvDriver({}),
          }),
        }),
    }, _normalizer),
    opts,
  );
}

{
  const opts = { staleRetention: "evict" as const };
  const db = Math.floor(Math.random() * 10);
  runSharedTests(
    "unstorage:redis:evict",
    new CacheStorage({
      create: async () =>
        new CachePersistenceUnstorage({
          ...opts,
          storage: createUnstorage({
            driver: redisDriver({
              url: `redis://127.0.0.1:${_redisPort}/${db}`,
            }),
          }),
        }),
    }, _normalizer),
    opts,
  );
}

{
  const opts = { staleRetention: "retain" as const };
  const db = Math.floor(Math.random() * 10);
  runSharedTests(
    "unstorage:redis:retain",
    new CacheStorage({
      create: async () =>
        new CachePersistenceUnstorage({
          ...opts,
          storage: createUnstorage({
            driver: redisDriver({
              url: `redis://127.0.0.1:${_redisPort}/${db}`,
            }),
          }),
        }),
    }, _normalizer),
    opts,
  );
}

{
  const opts = { staleRetention: "evict" as const };
  runSharedTests(
    "unstorage:fs-lite:evict",
    new CacheStorage({
      create: async () =>
        new CachePersistenceUnstorage({
          ...opts,
          storage: createUnstorage({
            driver: fsLiteDriver({ base: "tmp/test-fs-evict" }),
          }),
        }),
    }, _normalizer),
    opts,
  );
}

{
  const opts = { staleRetention: "retain" as const };
  runSharedTests(
    "unstorage:fs-lite:retain",
    new CacheStorage({
      create: async () =>
        new CachePersistenceUnstorage({
          ...opts,
          storage: createUnstorage({
            driver: fsLiteDriver({ base: "tmp/test-fs-retain" }),
          }),
        }),
    }, _normalizer),
    opts,
  );
}

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

import { assert, assertEquals, assertRejects } from "@std/assert";
import { createStorage as createUnstorage } from "unstorage";
import fsLiteDriver from "unstorage/drivers/fs-lite";
import redisDriver from "unstorage/drivers/redis";
import denoKvDriver from "unstorage/drivers/deno-kv";
import memoryDriver from "unstorage/drivers/lru-cache";
import databaseDriver from "unstorage/drivers/db0";
import { createDatabase } from "db0";
import postgresql from "db0/connectors/postgresql";
import { runSharedTests } from "../_shared/cache_storage_test.ts";
import {
  nextPort,
  startDenoKv,
  startPostgres,
  startRedis,
} from "../_shared/test_utils.ts";
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
globalThis.addEventListener("unload", () => {
  try {
    new Deno.Command("docker", { args: ["stop", _redisServer.containerId] })
      .outputSync();
  } catch {}
});

const _denokvPort = nextPort();
const _denokvServer = await startDenoKv({ port: _denokvPort });
globalThis.addEventListener("unload", () => {
  try {
    new Deno.Command("docker", { args: ["stop", _denokvServer.containerId] })
      .outputSync();
  } catch {}
});

const _pgPort = nextPort();
const _pgServer = await startPostgres({ port: _pgPort });
globalThis.addEventListener("unload", () => {
  try {
    new Deno.Command("docker", { args: ["stop", _pgServer.containerId] })
      .outputSync();
  } catch {}
});

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
  await runSharedTests(
    "unstorage:deno-kv:evict",
    new CacheStorage({
      create: async () =>
        new CachePersistenceUnstorage({
          ...opts,
          storage: createUnstorage({
            driver: denoKvDriver({
              openKv: () => Deno.openKv(`http://127.0.0.1:${_denokvPort}`),
            }),
          }),
        }),
    }, _normalizer),
    opts,
  );
}

{
  const opts = { staleRetention: "retain" as const };
  await runSharedTests(
    "unstorage:deno-kv:retain",
    new CacheStorage({
      create: async () =>
        new CachePersistenceUnstorage({
          ...opts,
          storage: createUnstorage({
            driver: denoKvDriver({
              openKv: () => Deno.openKv(`http://127.0.0.1:${_denokvPort}`),
            }),
          }),
        }),
    }, _normalizer),
    opts,
  );
}

{
  const opts = { staleRetention: "evict" as const };
  await runSharedTests(
    "unstorage:postgres:evict",
    new CacheStorage({
      create: async () => {
        const _pgDb = createDatabase(postgresql({
          url: `postgresql://postgres:postgres@127.0.0.1:${_pgPort}/postgres`,
        }));
        // Suppress pg connection errors during container shutdown
        (async () => {
          const client = await _pgDb.getInstance().catch(() => null);
          if (client && typeof client.on === "function") {
            client.on("error", () => {});
          }
        })();
        return new CachePersistenceUnstorage({
          ...opts,
          storage: createUnstorage({
            driver: databaseDriver({
              database: _pgDb,
            }),
          }),
        });
      },
    }, _normalizer),
    opts,
  );
}

{
  const opts = { staleRetention: "retain" as const };
  await runSharedTests(
    "unstorage:postgres:retain",
    new CacheStorage({
      create: async () => {
        const _pgDb = createDatabase(postgresql({
          url: `postgresql://postgres:postgres@127.0.0.1:${_pgPort}/postgres`,
        }));
        // Suppress pg connection errors during container shutdown
        (async () => {
          const client = await _pgDb.getInstance().catch(() => null);
          if (client && typeof client.on === "function") {
            client.on("error", () => {});
          }
        })();
        return new CachePersistenceUnstorage({
          ...opts,
          storage: createUnstorage({
            driver: databaseDriver({
              database: _pgDb,
            }),
          }),
        });
      },
    }, _normalizer),
    opts,
  );
}

{
  const opts = { staleRetention: "evict" as const };
  const db = Math.floor(Math.random() * 10);
  await runSharedTests(
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
  await runSharedTests(
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
  await runSharedTests(
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
  await runSharedTests(
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

Deno.test("Unstorage — stale index entry pointing to missing value returns undefined", async () => {
  const storage = createUnstorage();
  await using cache = await createCache({ storage });
  const req = new Request("http://example.com/stale");
  const res = new Response("body", {
    headers: { "cache-control": "max-age=3600" },
  });
  await cache.put(req, res);

  // Remove the value key while leaving the index entry intact, simulating a
  // driver that throws (e.g. ENOENT from fs) instead of returning null for a
  // missing key.
  const allKeys = await storage.getKeys();
  const valueKey = allKeys.find((k) => !k.endsWith("_"));
  if (valueKey) {
    await storage.removeItem(valueKey);
  }

  // Overwrite getItemRaw to throw for the missing key, as the fs driver does.
  const originalGetItemRaw = storage.getItemRaw.bind(storage);
  storage.getItemRaw = async (key: string) => {
    if (key === valueKey) throw new Error("ENOENT: no such file or directory");
    return originalGetItemRaw(key);
  };

  const result = await cache.match(req);
  assertEquals(
    result,
    undefined,
    "should treat a driver-thrown ENOENT as a cache miss, not propagate the error",
  );
});

Deno.test("Unstorage — corrupted index key returns empty set", async (t) => {
  const cases: Array<{ label: string; corrupt: Uint8Array | string }> = [
    {
      label: "zero-length Uint8Array",
      corrupt: new Uint8Array(0),
      // `new Uint8Array(0)` is truthy so a plain `!raw` guard would not catch
      // it; without `isEmpty`, TextDecoder decodes it to "" and JSON.parse("")
      // throws SyntaxError: Unexpected end of JSON input.
    },
    {
      label: "truncated JSON",
      corrupt: '["cachestorage:name:',
      // Partial write — non-empty, passes `isEmpty`, but JSON.parse throws
      // SyntaxError: Unexpected non-whitespace character after JSON.
    },
  ];

  for (const { label, corrupt } of cases) {
    await t.step(
      `should treat ${label} index as a cache miss, not throw`,
      async () => {
        const storage = createUnstorage();
        await using cache = await createCache({ storage });
        const req = new Request("http://example.com/corrupted");
        const res = new Response("body", {
          headers: { "cache-control": "max-age=3600" },
        });
        await cache.put(req, res);

        const allKeys = await storage.getKeys();
        const indexKey = allKeys.find((k) => k.endsWith("_"));
        if (indexKey) {
          await storage.setItemRaw(indexKey, corrupt);
        }

        const result = await cache.match(req);
        assertEquals(
          result,
          undefined,
          `should treat ${label} index as a cache miss, not throw`,
        );
      },
    );
  }
});

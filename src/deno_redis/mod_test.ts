import { assert, assertEquals } from "@std/assert";
import { CachePersistenceDenoRedis } from "./mod.ts";
import { CacheStorage } from "../core/cache_storage.ts";
import { runSharedTests } from "../_shared/cache_storage_test.ts";
import { nextPort, startRedis } from "../core/test_utils.ts";
import type { CachePersistenceDenoRedisOptions } from "../core/types.ts";

const port = nextPort();
const server = await startRedis({ port });

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

const _redisSharedNormalizer = (name: string, value: string | null) =>
  name === "user-agent" ? "firefox" : value;

runSharedTests(
  "deno-redis:evict",
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
    _redisSharedNormalizer,
  ),
  { staleRetention: "evict" },
);

runSharedTests(
  "deno-redis:retain",
  new CacheStorage(
    {
      create: async () =>
        new CachePersistenceDenoRedis({
          port,
          hostname: "127.0.0.1",
          max: 1,
          min: 1,
          staleRetention: "retain",
        }),
    },
    _redisSharedNormalizer,
  ),
  { staleRetention: "retain" },
);

// stopRedis(server);

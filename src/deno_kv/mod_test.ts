import { assert, assertEquals } from "@std/assert";
import { CachePersistenceDenoKv } from "./mod.ts";
import { CacheStorage } from "../core/cache_storage.ts";
import { runSharedTests } from "../_shared/cache_storage_test.ts";
import type { CachePersistenceDenoKvOptions } from "../core/types.ts";

import denoKvDefault, { denoKv } from "./mod.ts";

Deno.test("denoKv factory", async (t) => {
  const baseOptions: CachePersistenceDenoKvOptions = {
    max: 1,
    min: 1,
    path: ":memory:",
  };

  await t.step("default and named exports are identity-equal", () => {
    assertEquals(denoKvDefault, denoKv);
  });

  await t.step(
    "factory.create() returns CachePersistenceDenoKv",
    async () => {
      const factory = denoKv(baseOptions);
      await using instance = (await factory
        .create()) as CachePersistenceDenoKv;
      assert(instance instanceof CachePersistenceDenoKv);
    },
  );

  await t.step("options pass through to the instance", async () => {
    const factory = denoKv({ ...baseOptions, maxPersistenceTtlMs: 60_000 });
    await using instance = (await factory
      .create()) as CachePersistenceDenoKv;
    assertEquals(
      (instance as unknown as { _maxPersistenceTtlMs: number })
        ._maxPersistenceTtlMs,
      60_000,
    );
  });

  await t.step("no memoization across create() calls", async () => {
    const factory = denoKv(baseOptions);
    await using a = (await factory.create()) as CachePersistenceDenoKv;
    await using b = (await factory.create()) as CachePersistenceDenoKv;
    assert(a !== b);
  });

  await t.step("no state shared across factory-function calls", () => {
    const fA = denoKv(baseOptions);
    const fB = denoKv(baseOptions);
    assert(fA !== fB);
  });

  await t.step("does not mutate the options argument", async () => {
    const opts: CachePersistenceDenoKvOptions = {
      ...baseOptions,
      maxPersistenceTtlMs: 60_000,
      staleRetention: "retain" as const,
    };
    const snapshot = { ...opts };
    await using _instance = (await denoKv(opts)
      .create()) as CachePersistenceDenoKv;
    assertEquals(opts, snapshot);
  });
});

const _kvSharedNormalizer = (name: string, value: string | null) =>
  name === "user-agent" ? "firefox" : value;

{
  const opts = { staleRetention: "evict" as const };
  await runSharedTests(
    "deno-kv:evict",
    new CacheStorage({
      create: async () =>
        new CachePersistenceDenoKv({
          ...opts,
          path: "tmp/test-deno-kv-native",
          max: 1,
          min: 1,
        }),
    }, _kvSharedNormalizer),
    opts,
  );
}

{
  const opts = { staleRetention: "retain" as const };
  await runSharedTests(
    "deno-kv:retain",
    new CacheStorage(
      {
        create: async () =>
          new CachePersistenceDenoKv({
            ...opts,
            path: "tmp/test-deno-kv-native",
            max: 1,
            min: 1,
          }),
      },
      _kvSharedNormalizer,
    ),
    opts,
  );
}

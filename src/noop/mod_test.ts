import { assert, assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { CachePersistenceNoop } from "./mod.ts";
import { CacheStorage } from "../core/cache_storage.ts";
import type { CacheLike, CachePersistenceBaseOptions } from "../core/types.ts";

/**
 * Build a fresh `CacheStorage` backed by `CachePersistenceNoop` configured
 * per call. The noop accepts every option in the base option surface for
 * configuration-uniformity, but stores nothing — so the only observable
 * behavior is "nothing is ever stored, no matter the options". These tests
 * verify that contract through the public `Cache` API.
 */
function createStorage(
  options?: CachePersistenceBaseOptions,
): CacheStorage {
  return new CacheStorage({
    create: async () => new CachePersistenceNoop(options),
  });
}

let cacheCounter = 0;
function nextCacheName(): string {
  return `noop-test-${++cacheCounter}`;
}

/**
 * Open a unique-named cache against a freshly-configured Noop storage and
 * wrap its `Symbol.asyncDispose` to also call `storage.delete(name)` on
 * tear-down — matching the shape used by the Memory / KV / Redis test
 * files. For Noop the `storage.delete` is itself a no-op; the wrapping
 * exists only so every backend's test suite has the same call shape.
 */
async function createCache(
  options?: CachePersistenceBaseOptions,
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

async function assertNothingStored(
  cache: CacheLike,
  req: Request,
): Promise<void> {
  assertEquals(await cache.match(req), undefined);
  assertEquals((await cache.matchAll(req)).length, 0);
  assertEquals((await cache.matchAll()).length, 0);
}

Deno.test("Noop — options are accepted but nothing is ever stored", async (t) => {
  // `CachePersistenceNoop` writes a one-line summary to `console.log` on
  // every public-method call. The behavioral assertions below don't care
  // about that output, but Deno's test reporter surfaces it as "output"
  // blocks per step. Silence it for the duration of the test with a stub
  // that restores the original `console.log` on `[Symbol.dispose]`.
  using _consoleLogStub = stub(console, "log");

  await t.step("default options", async () => {
    await using cache = await createCache();
    const req = new Request("http://localhost/x");
    await cache.put(
      req,
      new Response("hi", {
        headers: { "cache-control": "max-age=3600" },
      }),
    );
    await assertNothingStored(cache, req);
  });

  await t.step(
    "staleRetention=retain + custom maxPersistenceTtlMs",
    async () => {
      await using cache = await createCache({
        staleRetention: "retain",
        maxPersistenceTtlMs: 60_000,
      });
      const req = new Request("http://localhost/x");
      await cache.put(req, new Response("hi"));
      await assertNothingStored(cache, req);
    },
  );

  await t.step(
    "staleRetention=evict + custom maxPersistenceTtlMs",
    async () => {
      await using cache = await createCache({
        staleRetention: "evict",
        maxPersistenceTtlMs: 2_592_000_000,
      });
      const req = new Request("http://localhost/x");
      await cache.put(
        req,
        new Response("hi", {
          headers: { "cache-control": "max-age=3600" },
        }),
      );
      await assertNothingStored(cache, req);
    },
  );
});

import noopDefault, { noop } from "./mod.ts";

Deno.test("noop factory", async (t) => {
  await t.step("default and named exports are identity-equal", () => {
    assertEquals(noopDefault, noop);
  });

  await t.step("factory.create() returns CachePersistenceNoop", async () => {
    const factory = noop();
    const instance = await factory.create();
    assert(instance instanceof CachePersistenceNoop);
  });

  await t.step("no memoization across create() calls", async () => {
    const factory = noop();
    const a = await factory.create();
    const b = await factory.create();
    assert(a !== b);
  });

  await t.step("no state shared across factory-function calls", () => {
    const fA = noop();
    const fB = noop();
    assert(fA !== fB);
  });

  await t.step("does not mutate the options argument", async () => {
    const opts: CachePersistenceBaseOptions = {
      maxPersistenceTtlMs: 60_000,
      staleRetention: "retain" as const,
    };
    const snapshot = { ...opts };
    // Silence the noop's per-call console.log so the test output stays clean.
    using _logStub = stub(console, "log");
    await noop(opts).create();
    assertEquals(opts, snapshot);
  });

  await t.step("behavior matches direct class instantiation", async () => {
    using _logStub = stub(console, "log");
    const fromFactory = await noop().create();
    const direct = new CachePersistenceNoop();
    const req = new Request("https://example.test/");
    const res = new Response("hi");
    assertEquals(
      await fromFactory.put("v1", req, res.clone()),
      await direct.put("v1", req, res.clone()),
    );
    assertEquals(
      (await fromFactory.keys()).length,
      (await direct.keys()).length,
    );
  });
});

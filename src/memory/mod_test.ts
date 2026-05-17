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

Deno.test("Memory — maxPersistenceTtlMs", async (t) => {
  await t.step(
    "caps storage lifetime below HTTP expiration",
    async () => {
      using time = new FakeTime();
      await using cache = await createCache({
        maxPersistenceTtlMs: 60_000,
      });
      const req = new Request("http://localhost/x");
      await cache.put(
        req,
        createFreshResponse("hello", { cacheControl: "max-age=3600" }),
      );

      await time.tickAsync(30_000);
      const mid = await cache.match(req);
      assert(mid !== undefined, "expected match before cap");
      assertEquals(await mid.text(), "hello");

      await time.tickAsync(31_000);
      assertEquals(await cache.match(req), undefined);
    },
  );

  await t.step(
    "does not extend HTTP expiration",
    async () => {
      using time = new FakeTime();
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

  await t.step(
    "bounds the lifetime of a stale entry (retain mode)",
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

      await time.tickAsync(30_000);
      const stale = await cache.match(req);
      assert(stale !== undefined, "expected stale match within cap");
      assertEquals(stale.headers.get("x-cachestorage-stale"), "1");

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
      await cache.put(
        req,
        createFreshResponse("B", { cacheControl: "max-age=60" }),
      );

      const matches = await cache.matchAll(req);
      assertEquals(matches.length, 1);
      assertEquals(await matches[0].text(), "B");
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

const _memorySharedNormalizer = (name: string, value: string | null) =>
  name === "user-agent" ? "firefox" : value;

runSharedTests(
  "memory:evict",
  new CacheStorage(
    undefined,
    _memorySharedNormalizer,
  ),
  { staleRetention: "evict" },
);

runSharedTests(
  "memory:retain",
  new CacheStorage(
    (() => {
      let persistence;
      return {
        async create() {
          persistence ??= new CachePersistenceMemory({
            staleRetention: "retain",
          });
          return persistence;
        },
      };
    })(),
    _memorySharedNormalizer,
  ),
  { staleRetention: "retain" },
);

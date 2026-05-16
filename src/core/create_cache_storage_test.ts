import { assert, assertEquals } from "@std/assert";
import { CacheStorage, createCacheStorage } from "./cache_storage.ts";
import { Cache } from "./cache.ts";
import { CachePersistenceMemory, memory } from "../memory/mod.ts";

Deno.test("createCacheStorage", async (t) => {
  await t.step(
    "with no args returns a working CacheStorage",
    async () => {
      const caches = createCacheStorage();
      assert(caches instanceof CacheStorage);
      const cache = await caches.open("default");
      const matched = await cache.match(
        new Request("https://example.test/"),
      );
      assertEquals(matched, undefined);
    },
  );

  await t.step(
    "forwards a factory under the persistence key",
    async () => {
      const caches = createCacheStorage({ persistence: memory() });
      await using cache = await caches.open("v1");
      const req = new Request("https://example.test/forward-factory");
      await cache.put(
        req,
        new Response("hi", {
          headers: { "cache-control": "max-age=60" },
        }),
      );
      const matched = await cache.match(req);
      assert(matched !== undefined);
      assertEquals(await matched.text(), "hi");
    },
  );

  await t.step(
    "forwards a class constructor under the persistence key",
    async () => {
      const caches = createCacheStorage({
        persistence: CachePersistenceMemory,
      });
      await using cache = await caches.open("v1");
      assert(cache !== undefined);
      // Round-trip verifies the constructable form was honoured.
      const req = new Request(
        "https://example.test/forward-constructable",
      );
      await cache.put(
        req,
        new Response("hi", {
          headers: { "cache-control": "max-age=60" },
        }),
      );
      const matched = await cache.match(req);
      assert(matched !== undefined);
      assertEquals(await matched.text(), "hi");
    },
  );

  await t.step("forwards headerNormalizer", async () => {
    const caches = createCacheStorage({
      persistence: memory(),
      headerNormalizer: (name, value) =>
        name === "x-custom" ? (value ?? "").toUpperCase() : value,
    });
    await using cache = await caches.open("v1");
    const req = new Request("https://example.test/normalize", {
      headers: { "x-custom": "foo", vary: "x-custom" },
    });
    await cache.put(
      req,
      new Response("hi", {
        headers: {
          "cache-control": "max-age=60",
          vary: "x-custom",
        },
      }),
    );
    // The stored entry was indexed under the normalized header. A
    // request whose x-custom value is the lowercase form should still
    // match because the normalizer turns it into the same uppercase
    // form that was stored.
    const matched = await cache.match(
      new Request("https://example.test/normalize", {
        headers: { "x-custom": "FOO", vary: "x-custom" },
      }),
    );
    assert(matched !== undefined);
    assertEquals(await matched.text(), "hi");
  });

  await t.step("forwards a custom Cache constructor", async () => {
    class MyCache extends Cache {
      readonly _isCustom = true;
    }
    const caches = createCacheStorage({
      persistence: memory(),
      Cache: MyCache,
    });
    const cache = await caches.open("v1");
    assert(cache instanceof MyCache);
    assertEquals(
      (cache as unknown as { _isCustom: boolean })._isCustom,
      true,
    );
  });
});

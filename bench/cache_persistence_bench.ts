import { CachePersistenceDenoKv } from "../src/deno_kv/mod.ts";
import { CachePersistenceMemory } from "../src/memory/mod.ts";
import { CachePersistenceDenoRedis } from "../src/deno_redis/mod.ts";
import { CachePersistenceUnstorage } from "../src/unstorage/mod.ts";
import { CacheStorage } from "../src/core/cache_storage.ts";
import { createStorage } from "unstorage";
import denoKvDriver from "unstorage/drivers/deno-kv";
import fsLiteDriver from "unstorage/drivers/fs-lite";
import memoryDriver from "unstorage/drivers/lru-cache";
import redisDriver from "unstorage/drivers/redis";
import {
  generateRandomRequest,
  generateRandomResponse,
  nextPort,
  startRedis,
  stopRedis,
} from "../src/core/test_utils.ts";

// const port = 6379;
const port = nextPort();
const server = await startRedis({ port });

const cachesRedis = new CacheStorage({
  create: async () =>
    new CachePersistenceDenoRedis({
      port,
      hostname: "127.0.0.1",
      // max: 1,
      // min: 1,
    }),
});
const cacheRedis = await cachesRedis.open("default");

const cachesKv = new CacheStorage({
  create: async () =>
    new CachePersistenceDenoKv({
      max: 1,
      min: 1,
    }),
});
const cacheKv = await cachesKv.open("default");

const cachesMemory = new CacheStorage(CachePersistenceMemory);
const cacheMemory = await cachesMemory.open("default");

const storageMem = createStorage({ driver: memoryDriver({}) });
const cachesUnstorageMem = new CacheStorage({
  create: async () => new CachePersistenceUnstorage({ storage: storageMem }),
});
const cacheUnstorageMem = await cachesUnstorageMem.open("default");

const storageKv = createStorage({ driver: denoKvDriver({}) });
const cachesUnstorageKv = new CacheStorage({
  create: async () => new CachePersistenceUnstorage({ storage: storageKv }),
});
const cacheUnstorageKv = await cachesUnstorageKv.open("default");

const storageRedis = createStorage({
  driver: redisDriver({ url: `redis://127.0.0.1:${port}` }),
});
const cachesUnstorageRedis = new CacheStorage({
  create: async () => new CachePersistenceUnstorage({ storage: storageRedis }),
});
const cacheUnstorageRedis = await cachesUnstorageRedis.open("default");

const storageFs = createStorage({
  driver: fsLiteDriver({ base: "tmp/bench-fs" }),
});
const cachesUnstorageFs = new CacheStorage({
  create: async () => new CachePersistenceUnstorage({ storage: storageFs }),
});
const cacheUnstorageFs = await cachesUnstorageFs.open("default");

const cacheNative = await caches.open("default");

// ---------------------------------

async function fillCache(
  cache: Cache,
  num = 100,
): Promise<() => Promise<void>> {
  const promises: Array<Promise<void>> = [];
  const requests: Array<Request> = [];
  for (let i = 0; i < num; i += 1) {
    const request = generateRandomRequest();
    const response = generateRandomResponse();
    promises.push(cache.put(request, response));
    requests.push(request);
  }
  await Promise.allSettled(promises);
  return async () => {
    for (const req of requests) {
      await cache.delete(req, {
        ignoreMethod: true,
        ignoreSearch: true,
        ignoreVary: true,
      });
    }
  };
}

// ---------------------------------

Deno.bench(
  "CachePersistenceNative",
  { group: "put(req, res)" },
  async (b) => {
    const cache = cacheNative;
    const request = generateRandomRequest();
    const response = generateRandomResponse();
    b.start();
    try {
      await cache.put(request, response);
    } catch {}
    b.end();
    await cache.delete(request, {
      ignoreMethod: true,
      ignoreSearch: true,
      ignoreVary: true,
    });
  },
);

Deno.bench(
  "CachePersistenceMemory",
  { group: "put(req, res)", baseline: true },
  async (b) => {
    const cache = cacheMemory;
    const request = generateRandomRequest();
    const response = generateRandomResponse();
    b.start();
    try {
      await cache.put(request, response);
    } catch {}
    b.end();
    await cache.delete(request, {
      ignoreMethod: true,
      ignoreSearch: true,
      ignoreVary: true,
    });
  },
);

Deno.bench(
  "CachePersistenceDenoRedis",
  { group: "put(req, res)" },
  async (b) => {
    const cache = cacheRedis;
    const request = generateRandomRequest();
    const response = generateRandomResponse();
    b.start();
    try {
      await cache.put(request, response);
    } catch {}
    b.end();
    await cache.delete(request, {
      ignoreMethod: true,
      ignoreSearch: true,
      ignoreVary: true,
    });
  },
);

Deno.bench("CachePersistenceKv", { group: "put(req, res)" }, async (b) => {
  const cache = cacheKv;
  const request = generateRandomRequest();
  const response = generateRandomResponse();
  b.start();
  try {
    await cache.put(request, response);
  } catch {}
  b.end();
  await cache.delete(request, {
    ignoreMethod: true,
    ignoreSearch: true,
    ignoreVary: true,
  });
});

Deno.bench(
  "CachePersistenceUnstorageMemory",
  { group: "put(req, res)" },
  async (b) => {
    const cache = cacheUnstorageMem;
    const request = generateRandomRequest();
    const response = generateRandomResponse();
    b.start();
    try {
      await cache.put(request, response);
    } catch {}
    b.end();
    await cache.delete(request, {
      ignoreMethod: true,
      ignoreSearch: true,
      ignoreVary: true,
    });
  },
);

Deno.bench(
  "CachePersistenceUnstorageDenoKv",
  { group: "put(req, res)" },
  async (b) => {
    const cache = cacheUnstorageKv;
    const request = generateRandomRequest();
    const response = generateRandomResponse();
    b.start();
    try {
      await cache.put(request, response);
    } catch {}
    b.end();
    await cache.delete(request, {
      ignoreMethod: true,
      ignoreSearch: true,
      ignoreVary: true,
    });
  },
);

Deno.bench(
  "CachePersistenceUnstorageRedis",
  { group: "put(req, res)" },
  async (b) => {
    const cache = cacheUnstorageRedis;
    const request = generateRandomRequest();
    const response = generateRandomResponse();
    b.start();
    try {
      await cache.put(request, response);
    } catch {}
    b.end();
    await cache.delete(request, {
      ignoreMethod: true,
      ignoreSearch: true,
      ignoreVary: true,
    });
  },
);

Deno.bench(
  "CachePersistenceUnstorageFs",
  { group: "put(req, res)" },
  async (b) => {
    const cache = cacheUnstorageFs;
    const request = generateRandomRequest();
    const response = generateRandomResponse();
    b.start();
    try {
      await cache.put(request, response);
    } catch {}
    b.end();
    await cache.delete(request, {
      ignoreMethod: true,
      ignoreSearch: true,
      ignoreVary: true,
    });
  },
);

// ---------------------------------

Deno.bench(
  "CachePersistenceNative",
  { group: "match(req)" },
  async (b) => {
    const cache = cacheNative;
    const clean = await fillCache(cache);
    const request = generateRandomRequest();
    b.start();
    await cache.match(request);
    b.end();
    await clean();
  },
);

Deno.bench(
  "CachePersistenceMemory",
  { group: "match(req)", baseline: true },
  async (b) => {
    const cache = cacheMemory;
    const clean = await fillCache(cache);
    const request = generateRandomRequest();
    b.start();
    await cache.match(request);
    b.end();
    await clean();
  },
);

Deno.bench("CachePersistenceDenoRedis", { group: "match(req)" }, async (b) => {
  const cache = cacheRedis;
  const clean = await fillCache(cache);
  const request = generateRandomRequest();
  b.start();
  await cache.match(request);
  b.end();
  await clean();
});

Deno.bench("CachePersistenceKv", { group: "match(req)" }, async (b) => {
  const cache = cacheKv;
  const clean = await fillCache(cache);
  const request = generateRandomRequest();
  b.start();
  await cache.match(request);
  b.end();
  await clean();
});

Deno.bench(
  "CachePersistenceUnstorageMemory",
  { group: "match(req)" },
  async (b) => {
    const cache = cacheUnstorageMem;
    const clean = await fillCache(cache);
    const request = generateRandomRequest();
    b.start();
    await cache.match(request);
    b.end();
    await clean();
  },
);

Deno.bench(
  "CachePersistenceUnstorageDenoKv",
  { group: "match(req)" },
  async (b) => {
    const cache = cacheUnstorageKv;
    const clean = await fillCache(cache);
    const request = generateRandomRequest();
    b.start();
    await cache.match(request);
    b.end();
    await clean();
  },
);

Deno.bench(
  "CachePersistenceUnstorageRedis",
  { group: "match(req)" },
  async (b) => {
    const cache = cacheUnstorageRedis;
    const clean = await fillCache(cache);
    const request = generateRandomRequest();
    b.start();
    await cache.match(request);
    b.end();
    await clean();
  },
);

Deno.bench(
  "CachePersistenceUnstorageFs",
  { group: "match(req)" },
  async (b) => {
    const cache = cacheUnstorageFs;
    const clean = await fillCache(cache);
    const request = generateRandomRequest();
    b.start();
    await cache.match(request);
    b.end();
    await clean();
  },
);

// ---------------------------------

/*
Deno.bench(
    'CachePersistenceNative',
    { group: 'matchAll(req)' },
    async (b) => {
        const cache = cacheNative;
        const clean = await fillCache(cache);
        const request = generateRandomRequest();
        b.start();
        await cache.matchAll(request);
        b.end();
        await clean();
    },
);
*/

Deno.bench(
  "CachePersistenceMemory",
  { group: "matchAll(req)", baseline: true },
  async (b) => {
    const cache = cacheMemory;
    const clean = await fillCache(cache);
    const request = generateRandomRequest();
    b.start();
    await cache.matchAll(request);
    b.end();
    await clean();
  },
);

Deno.bench(
  "CachePersistenceDenoRedis",
  { group: "matchAll(req)" },
  async (b) => {
    const cache = cacheRedis;
    const clean = await fillCache(cache);
    const request = generateRandomRequest();
    b.start();
    await cache.matchAll(request);
    b.end();
    await clean();
  },
);

Deno.bench("CachePersistenceKv", { group: "matchAll(req)" }, async (b) => {
  const cache = cacheKv;
  const clean = await fillCache(cache);
  const request = generateRandomRequest();
  b.start();
  await cache.matchAll(request);
  b.end();
  await clean();
});

Deno.bench(
  "CachePersistenceUnstorageMemory",
  { group: "matchAll(req)" },
  async (b) => {
    const cache = cacheUnstorageMem;
    const clean = await fillCache(cache);
    const request = generateRandomRequest();
    b.start();
    await cache.matchAll(request);
    b.end();
    await clean();
  },
);

Deno.bench(
  "CachePersistenceUnstorageDenoKv",
  { group: "matchAll(req)" },
  async (b) => {
    const cache = cacheUnstorageKv;
    const clean = await fillCache(cache);
    const request = generateRandomRequest();
    b.start();
    await cache.matchAll(request);
    b.end();
    await clean();
  },
);

Deno.bench(
  "CachePersistenceUnstorageRedis",
  { group: "matchAll(req)" },
  async (b) => {
    const cache = cacheUnstorageRedis;
    const clean = await fillCache(cache);
    const request = generateRandomRequest();
    b.start();
    await cache.matchAll(request);
    b.end();
    await clean();
  },
);

Deno.bench(
  "CachePersistenceUnstorageFs",
  { group: "matchAll(req)" },
  async (b) => {
    const cache = cacheUnstorageFs;
    const clean = await fillCache(cache);
    const request = generateRandomRequest();
    b.start();
    await cache.matchAll(request);
    b.end();
    await clean();
  },
);

Deno.bench(
  "CachePersistenceUnstorageFs",
  { group: "matchAll()" },
  async (b) => {
    const cache = cacheUnstorageFs;
    const clean = await fillCache(cache);
    b.start();
    await cache.matchAll();
    b.end();
    await clean();
  },
);

// ---------------------------------
//     'CachePersistenceNative',
//     { group: 'matchAll()' },
//     async (b) => {
//         const cache = cacheNative;
//         const clean = await fillCache(cache);
//         b.start();
//         await cache.matchAll();
//         b.end();
//         await clean();
//     },
// );

Deno.bench(
  "CachePersistenceMemory",
  { group: "matchAll()", baseline: true },
  async (b) => {
    const cache = cacheMemory;
    const clean = await fillCache(cache);
    b.start();
    await cache.matchAll();
    b.end();
    await clean();
  },
);

Deno.bench("CachePersistenceDenoRedis", { group: "matchAll()" }, async (b) => {
  const cache = cacheRedis;
  const clean = await fillCache(cache);
  b.start();
  await cache.matchAll();
  b.end();
  await clean();
});

Deno.bench("CachePersistenceKv", { group: "matchAll()" }, async (b) => {
  const cache = cacheKv;
  const clean = await fillCache(cache);
  b.start();
  await cache.matchAll();
  b.end();
  await clean();
});

Deno.bench(
  "CachePersistenceUnstorageMemory",
  { group: "matchAll()" },
  async (b) => {
    const cache = cacheUnstorageMem;
    const clean = await fillCache(cache);
    b.start();
    await cache.matchAll();
    b.end();
    await clean();
  },
);

Deno.bench(
  "CachePersistenceUnstorageDenoKv",
  { group: "matchAll()" },
  async (b) => {
    const cache = cacheUnstorageKv;
    const clean = await fillCache(cache);
    b.start();
    await cache.matchAll();
    b.end();
    await clean();
  },
);

Deno.bench(
  "CachePersistenceUnstorageRedis",
  { group: "matchAll()" },
  async (b) => {
    const cache = cacheUnstorageRedis;
    const clean = await fillCache(cache);
    b.start();
    await cache.matchAll();
    b.end();
    await clean();
  },
);

// ---------------------------------

Deno.bench(
  "CachePersistenceNative",
  { group: "delete(req)" },
  async (b) => {
    const cache = cacheNative;
    const clean = await fillCache(cache);
    const request = generateRandomRequest();
    b.start();
    await cache.delete(request, {
      ignoreMethod: true,
      ignoreSearch: true,
      ignoreVary: true,
    });
    b.end();
    await clean();
  },
);

Deno.bench(
  "CachePersistenceMemory",
  { group: "delete(req)", baseline: true },
  async (b) => {
    const cache = cacheMemory;
    const clean = await fillCache(cache);
    const request = generateRandomRequest();
    b.start();
    await cache.delete(request, {
      ignoreMethod: true,
      ignoreSearch: true,
      ignoreVary: true,
    });
    b.end();
    await clean();
  },
);

Deno.bench("CachePersistenceDenoRedis", { group: "delete(req)" }, async (b) => {
  const cache = cacheRedis;
  const clean = await fillCache(cache);
  const request = generateRandomRequest();
  b.start();
  await cache.delete(request, {
    ignoreMethod: true,
    ignoreSearch: true,
    ignoreVary: true,
  });
  b.end();
  await clean();
});

Deno.bench("CachePersistenceKv", { group: "delete(req)" }, async (b) => {
  const cache = cacheKv;
  const clean = await fillCache(cache);
  const request = generateRandomRequest();
  b.start();
  await cache.delete(request, {
    ignoreMethod: true,
    ignoreSearch: true,
    ignoreVary: true,
  });
  b.end();
  await clean();
});

Deno.bench(
  "CachePersistenceUnstorageMemory",
  { group: "delete(req)" },
  async (b) => {
    const cache = cacheUnstorageMem;
    const clean = await fillCache(cache);
    const request = generateRandomRequest();
    b.start();
    await cache.delete(request, {
      ignoreMethod: true,
      ignoreSearch: true,
      ignoreVary: true,
    });
    b.end();
    await clean();
  },
);

Deno.bench(
  "CachePersistenceUnstorageDenoKv",
  { group: "delete(req)" },
  async (b) => {
    const cache = cacheUnstorageKv;
    const clean = await fillCache(cache);
    const request = generateRandomRequest();
    b.start();
    await cache.delete(request, {
      ignoreMethod: true,
      ignoreSearch: true,
      ignoreVary: true,
    });
    b.end();
    await clean();
  },
);

Deno.bench(
  "CachePersistenceUnstorageRedis",
  { group: "delete(req)" },
  async (b) => {
    const cache = cacheUnstorageRedis;
    const clean = await fillCache(cache);
    const request = generateRandomRequest();
    b.start();
    await cache.delete(request, {
      ignoreMethod: true,
      ignoreSearch: true,
      ignoreVary: true,
    });
    b.end();
    await clean();
  },
);

Deno.bench(
  "CachePersistenceUnstorageFs",
  { group: "delete(req)" },
  async (b) => {
    const cache = cacheUnstorageFs;
    const clean = await fillCache(cache);
    const request = generateRandomRequest();
    b.start();
    await cache.delete(request, {
      ignoreMethod: true,
      ignoreSearch: true,
      ignoreVary: true,
    });
    b.end();
    await clean();
  },
);

// ---------------------------------

Deno.bench(
  "CachePersistenceNative",
  { group: "delete()" },
  async (_b) => {
    await caches.delete("default");
  },
);

Deno.bench(
  "CachePersistenceMemory",
  { group: "delete()", baseline: true },
  async (_b) => {
    await cachesMemory.delete("default");
  },
);

Deno.bench("CachePersistenceDenoRedis", { group: "delete()" }, async (b) => {
  b.start();
  await cachesRedis.delete("default");
  b.end();
  //stopRedis(server);
});

Deno.bench("CachePersistenceKv", { group: "delete()" }, async (_b) => {
  await cachesKv.delete("default");
});

Deno.bench(
  "CachePersistenceUnstorageMemory",
  { group: "delete()" },
  async (_b) => {
    await cachesUnstorageMem.delete("default");
  },
);

Deno.bench(
  "CachePersistenceUnstorageDenoKv",
  { group: "delete()" },
  async (_b) => {
    await cachesUnstorageKv.delete("default");
  },
);

Deno.bench(
  "CachePersistenceUnstorageRedis",
  { group: "delete()" },
  async (b) => {
    b.start();
    await cachesUnstorageRedis.delete("default");
    b.end();
  },
);

Deno.bench(
  "CachePersistenceUnstorageFs",
  { group: "delete()" },
  async (_b) => {
    await cachesUnstorageFs.delete("default");
  },
);

import { CachePersistenceDenoKv } from './cache-persistence-deno-kv.ts';
import { CachePersistenceMemory } from './cache-persistence-memory.ts';
import { CachePersistenceRedis } from './cache-persistence-redis.ts';
import { CacheStorage } from './cache-storage.ts';
import {
    generateRandomRequest,
    generateRandomResponse,
    nextPort,
    startRedis,
    stopRedis,
} from './test-utils.ts';

// const port = 6379;
const port = nextPort();
const server = await startRedis({ port });

const cachesRedis = new CacheStorage({
    create: async () =>
        new CachePersistenceRedis({
            port,
            hostname: '127.0.0.1',
            // max: 1,
            // min: 1,
        }),
});
const cacheRedis = await cachesRedis.open('default');

const cachesKv = new CacheStorage({
    create: async () =>
        new CachePersistenceDenoKv({
            max: 1,
            min: 1,
        }),
});
const cacheKv = await cachesKv.open('default');

const cachesMemory = new CacheStorage(CachePersistenceMemory);
const cacheMemory = await cachesMemory.open('default');

const cacheNative = await caches.open('default');

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
    'CachePersistenceNative',
    { group: 'put(req, res)' },
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
    'CachePersistenceMemory',
    { group: 'put(req, res)', baseline: true },
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

Deno.bench('CachePersistenceRedis', { group: 'put(req, res)' }, async (b) => {
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
});

Deno.bench('CachePersistenceKv', { group: 'put(req, res)' }, async (b) => {
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

// ---------------------------------

Deno.bench(
    'CachePersistenceNative',
    { group: 'match(req)' },
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
    'CachePersistenceMemory',
    { group: 'match(req)', baseline: true },
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

Deno.bench('CachePersistenceRedis', { group: 'match(req)' }, async (b) => {
    const cache = cacheRedis;
    const clean = await fillCache(cache);
    const request = generateRandomRequest();
    b.start();
    await cache.match(request);
    b.end();
    await clean();
});

Deno.bench('CachePersistenceKv', { group: 'match(req)' }, async (b) => {
    const cache = cacheKv;
    const clean = await fillCache(cache);
    const request = generateRandomRequest();
    b.start();
    await cache.match(request);
    b.end();
    await clean();
});

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
    'CachePersistenceMemory',
    { group: 'matchAll(req)', baseline: true },
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

Deno.bench('CachePersistenceRedis', { group: 'matchAll(req)' }, async (b) => {
    const cache = cacheRedis;
    const clean = await fillCache(cache);
    const request = generateRandomRequest();
    b.start();
    await cache.matchAll(request);
    b.end();
    await clean();
});

Deno.bench('CachePersistenceKv', { group: 'matchAll(req)' }, async (b) => {
    const cache = cacheKv;
    const clean = await fillCache(cache);
    const request = generateRandomRequest();
    b.start();
    await cache.matchAll(request);
    b.end();
    await clean();
});

// ---------------------------------

// Deno.bench(
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
    'CachePersistenceMemory',
    { group: 'matchAll()', baseline: true },
    async (b) => {
        const cache = cacheMemory;
        const clean = await fillCache(cache);
        b.start();
        await cache.matchAll();
        b.end();
        await clean();
    },
);

Deno.bench('CachePersistenceRedis', { group: 'matchAll()' }, async (b) => {
    const cache = cacheRedis;
    const clean = await fillCache(cache);
    b.start();
    await cache.matchAll();
    b.end();
    await clean();
});

Deno.bench('CachePersistenceKv', { group: 'matchAll()' }, async (b) => {
    const cache = cacheKv;
    const clean = await fillCache(cache);
    b.start();
    await cache.matchAll();
    b.end();
    await clean();
});

// ---------------------------------

Deno.bench(
    'CachePersistenceNative',
    { group: 'delete(req)' },
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
    'CachePersistenceMemory',
    { group: 'delete(req)', baseline: true },
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

Deno.bench('CachePersistenceRedis', { group: 'delete(req)' }, async (b) => {
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

Deno.bench('CachePersistenceKv', { group: 'delete(req)' }, async (b) => {
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

// ---------------------------------

Deno.bench(
    'CachePersistenceNative',
    { group: 'delete()' },
    async (_b) => {
        await caches.delete('default');
    },
);

Deno.bench(
    'CachePersistenceMemory',
    { group: 'delete()', baseline: true },
    async (_b) => {
        await cachesMemory.delete('default');
    },
);

Deno.bench('CachePersistenceRedis', { group: 'delete()' }, async (_b) => {
    await cachesRedis.delete('default');
});

Deno.bench('CachePersistenceKv', { group: 'delete()' }, async (_b) => {
    await cachesKv.delete('default');
});

// stopRedis(server);

import { CachePersistenceDenoKv } from './cache-persistence-denokv.ts';
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

// const cachesRedis = new CacheStorage({
//     create: async () =>
//         new CachePersistenceRedis({
//             port: 6379,
//             hostname: 'positive-stingray-30817.upstash.io',
//             username: 'default',
//             password: 'AXhhAAIjcDEzMmNhZGMwYmY1NmQ0NzgzOGU5ZTFjZTE1NWU1YTRkN3AxMA',
//             tls: true,
//             // max: 1,
//             // min: 1,
//         }),
// });
// const cacheRedis = await cachesRedis.open('default');

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

Deno.bench(
    'CachePersistenceNative',
    { group: 'put(req, res)' },
    async (b) => {
        const request = generateRandomRequest();
        const response = generateRandomResponse();
        b.start();
        try {
            await cacheNative.put(request, response);
        } catch {}
        b.end();
    },
);

Deno.bench(
    'CachePersistenceMemory',
    { group: 'put(req, res)', baseline: true },
    async (b) => {
        const request = generateRandomRequest();
        const response = generateRandomResponse();
        b.start();
        try {
            await cacheMemory.put(request, response);
        } catch {}
        b.end();
    },
);

Deno.bench('CachePersistenceRedis', { group: 'put(req, res)' }, async (b) => {
    const request = generateRandomRequest();
    const response = generateRandomResponse();
    b.start();
    try {
        await cacheRedis.put(request, response);
    } catch {}
    b.end();
});

Deno.bench('CachePersistenceKv', { group: 'put(req, res)' }, async (b) => {
    const request = generateRandomRequest();
    const response = generateRandomResponse();
    b.start();
    try {
        await cacheKv.put(request, response);
    } catch {}
    b.end();
});

// ---------------------------------

Deno.bench(
    'CachePersistenceNative',
    { group: 'match(req)' },
    async (b) => {
        const request = generateRandomRequest();
        b.start();
        await cacheNative.match(request);
        b.end();
    },
);

Deno.bench(
    'CachePersistenceMemory',
    { group: 'match(req)', baseline: true },
    async (b) => {
        const request = generateRandomRequest();
        b.start();
        await cacheMemory.match(request);
        b.end();
    },
);

Deno.bench('CachePersistenceRedis', { group: 'match(req)' }, async (b) => {
    const request = generateRandomRequest();
    b.start();
    await cacheRedis.match(request);
    b.end();
});

Deno.bench('CachePersistenceKv', { group: 'match(req)' }, async (b) => {
    const request = generateRandomRequest();
    b.start();
    await cacheKv.match(request);
    b.end();
});

// ---------------------------------

/*
Deno.bench(
    'CachePersistenceMemory',
    { group: 'matchAll(req)', baseline: true },
    async (b) => {
        const request = generateRandomRequest();
        b.start();
        await cacheNative.matchAll(request);
        b.end();
    },
);
*/

Deno.bench(
    'CachePersistenceMemory',
    { group: 'matchAll(req)', baseline: true },
    async (b) => {
        const request = generateRandomRequest();
        b.start();
        await cacheMemory.matchAll(request);
        b.end();
    },
);

Deno.bench('CachePersistenceRedis', { group: 'matchAll(req)' }, async (b) => {
    const request = generateRandomRequest();
    b.start();
    await cacheRedis.matchAll(request);
    b.end();
});

Deno.bench('CachePersistenceKv', { group: 'matchAll(req)' }, async (b) => {
    const request = generateRandomRequest();
    b.start();
    await cacheKv.matchAll(request);
    b.end();
});

// ---------------------------------

// Deno.bench(
//     'CachePersistenceNative',
//     { group: 'matchAll()', baseline: true },
//     async (b) => {
//         await cacheNative.matchAll();
//     },
// );

Deno.bench(
    'CachePersistenceMemory',
    { group: 'matchAll()', baseline: true },
    async (b) => {
        await cacheMemory.matchAll();
    },
);

Deno.bench('CachePersistenceRedis', { group: 'matchAll()' }, async (b) => {
    await cacheRedis.matchAll();
});

Deno.bench('CachePersistenceKv', { group: 'matchAll()' }, async (b) => {
    await cacheKv.matchAll();
});

// ---------------------------------

Deno.bench(
    'CachePersistenceNative',
    { group: 'delete(req)' },
    async (b) => {
        const request = generateRandomRequest();
        b.start();
        await cacheNative.delete(request);
        b.end();
    },
);

Deno.bench(
    'CachePersistenceMemory',
    { group: 'delete(req)', baseline: true },
    async (b) => {
        const request = generateRandomRequest();
        b.start();
        await cacheMemory.delete(request);
        b.end();
    },
);

Deno.bench('CachePersistenceRedis', { group: 'delete(req)' }, async (b) => {
    const request = generateRandomRequest();
    b.start();
    await cacheRedis.delete(request);
    b.end();
});

Deno.bench('CachePersistenceKv', { group: 'delete(req)' }, async (b) => {
    const request = generateRandomRequest();
    b.start();
    await cacheKv.delete(request);
    b.end();
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

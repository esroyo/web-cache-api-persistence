import { assert, assertEquals } from '@std/assert';
import { delay } from '@std/async/delay';
import { CachePersistenceDenoKv } from './cache-persistence-deno-kv.ts';
import { CacheStorage } from './cache-storage.ts';
import type { CacheLike, CachePersistenceDenoKvOptions } from './types.ts';

/**
 * Build a fresh `CacheStorage` whose backing persistence is a
 * `CachePersistenceDenoKv` configured per call.
 *
 * The behavioral tests below observe configuration solely through the
 * W3C-style `Cache` surface (`put` / `match` / `matchAll`) plus the
 * `x-cachestorage-stale` response header. They never read persistence
 * internals (`_dbPool`, `_evictionDelay`, …) and never spy on Deno KV's
 * `atomic` / `setBlob` boundary.
 *
 * Eviction in Deno KV is driven by the storage engine's own native
 * `expireIn`, which runs out-of-process and is lazy: an entry whose
 * `expireIn` has elapsed may continue to be returned by `kv.get` for some
 * unbounded time (until the engine sweeps it). For this reason these tests
 * do NOT attempt to assert "entry is physically gone at
 * `maxPersistenceTtlMs`". The contract this library can guarantee through
 * its public API is the in-process freshness/stale logic:
 *
 *  - under `evict`, HTTP-expired entries are filtered out by `get()` —
 *    `cache.match` returns `undefined`;
 *  - under `retain`, HTTP-expired entries are returned with the
 *    `x-cachestorage-stale: 1` marker.
 *
 * The storage-policy ceiling (`maxPersistenceTtlMs`) is observable only by
 * trusting the backend's `expireIn` primitive; its absolute timing is a
 * backend concern, not part of this library's surface.
 */
function createStorage(
    options?: Partial<CachePersistenceDenoKvOptions>,
): CacheStorage {
    return new CacheStorage({
        create: async () =>
            new CachePersistenceDenoKv({ max: 1, min: 1, ...options }),
    });
}

let cacheCounter = 0;
function nextCacheName(): string {
    return `kv-test-${++cacheCounter}`;
}

/**
 * Open a unique-named cache against a freshly-configured KV storage and
 * wrap its `Symbol.asyncDispose` to also call `storage.delete(name)` on
 * tear-down.
 *
 * Deno KV's default DB location (`Deno.openKv()` without a path) is
 * persistent both within and across test runs. The wrapped disposer
 * removes the cache name from the backing KV so the shared
 * `cache-storage.test.ts` suite (re-imported at the bottom of this file)
 * sees a clean view of `caches.keys()`. The cache name itself is drawn
 * from `nextCacheName()`, outside the `v1`/`v2`/`v3` namespace the shared
 * suite uses.
 */
async function createCache(
    options?: Partial<CachePersistenceDenoKvOptions>,
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
    init?: { cacheControl?: string },
): Response {
    return new Response(body, {
        headers: {
            date: new Date(Date.now()).toUTCString(),
            ...(init?.cacheControl
                ? { 'cache-control': init.cacheControl }
                : {}),
        },
    });
}

Deno.test('Deno KV — staleRetention=evict (default)', async (t) => {
    await t.step(
        'an entry past its HTTP expiration is no longer matched',
        async () => {
            await using cache = await createCache();
            const req = new Request('http://localhost/x');
            await cache.put(
                req,
                createFreshResponse('hello', { cacheControl: 'max-age=1' }),
            );

            // Fresh window: entry is matched, no stale marker.
            const fresh = await cache.match(req);
            assert(fresh !== undefined, 'expected fresh match');
            assertEquals(await fresh.text(), 'hello');
            assertEquals(fresh.headers.get('x-cachestorage-stale'), null);

            // Past HTTP expiration under evict: filtered out by get().
            await delay(1_500);
            assertEquals(await cache.match(req), undefined);
        },
    );

    await t.step(
        'a response without explicit freshness is not stored',
        async () => {
            await using cache = await createCache();
            const req = new Request('http://localhost/x');
            // No Cache-Control, no Expires — RFC 9111 §4.2.1: no explicit
            // freshness lifetime. Under default `evict` this means "don't
            // store"; the entry must not be observable.
            await cache.put(req, new Response('hi'));
            assertEquals(await cache.match(req), undefined);
            assertEquals((await cache.matchAll(req)).length, 0);
        },
    );
});

Deno.test('Deno KV — staleRetention=retain', async (t) => {
    await t.step(
        'an entry past HTTP expiration is still matched, with stale marker',
        async () => {
            await using cache = await createCache({
                staleRetention: 'retain',
            });
            const req = new Request('http://localhost/x');
            await cache.put(
                req,
                createFreshResponse('hello', { cacheControl: 'max-age=1' }),
            );

            // Fresh window: matched, NO stale marker.
            const fresh = await cache.match(req);
            assert(fresh !== undefined, 'expected fresh match');
            assertEquals(fresh.headers.get('x-cachestorage-stale'), null);

            // Past HTTP expiration: still matched, marked stale.
            await delay(1_500);
            const stale = await cache.match(req);
            assert(stale !== undefined, 'expected stale under retain');
            assertEquals(await stale.text(), 'hello');
            assertEquals(stale.headers.get('x-cachestorage-stale'), '1');
        },
    );

    await t.step(
        'a header-less response is stored, and stale on first read',
        async () => {
            await using cache = await createCache({
                staleRetention: 'retain',
            });
            const req = new Request('http://localhost/x');
            await cache.put(req, new Response('hi'));

            const matched = await cache.match(req);
            assert(matched !== undefined, 'expected match under retain');
            assertEquals(await matched.text(), 'hi');
            assertEquals(matched.headers.get('x-cachestorage-stale'), '1');
        },
    );
});

Object.defineProperty(globalThis, 'caches', {
    value: new CacheStorage(
        {
            create: async () => new CachePersistenceDenoKv({ max: 1, min: 1 }),
        },
        (name, value) => (name === 'user-agent' ? 'firefox' : value),
    ),
});

await import('./cache-storage.test.ts');

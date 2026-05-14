import { assertEquals } from '@std/assert';
import { stub } from '@std/testing/mock';
import { CachePersistenceNoop } from './cache-persistence-noop.ts';
import { CacheStorage } from './cache-storage.ts';
import type { CacheLike, CachePersistenceBaseOptions } from './types.ts';

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

Deno.test('Noop — options are accepted but nothing is ever stored', async (t) => {
    // `CachePersistenceNoop` writes a one-line summary to `console.log` on
    // every public-method call. The behavioral assertions below don't care
    // about that output, but Deno's test reporter surfaces it as "output"
    // blocks per step. Silence it for the duration of the test with a stub
    // that restores the original `console.log` on `[Symbol.dispose]`.
    using _consoleLogStub = stub(console, 'log');

    await t.step('default options', async () => {
        await using cache = await createCache();
        const req = new Request('http://localhost/x');
        await cache.put(
            req,
            new Response('hi', {
                headers: { 'cache-control': 'max-age=3600' },
            }),
        );
        await assertNothingStored(cache, req);
    });

    await t.step(
        'staleRetention=retain + custom maxPersistenceTtlMs',
        async () => {
            await using cache = await createCache({
                staleRetention: 'retain',
                maxPersistenceTtlMs: 60_000,
            });
            const req = new Request('http://localhost/x');
            await cache.put(req, new Response('hi'));
            await assertNothingStored(cache, req);
        },
    );

    await t.step(
        'staleRetention=evict + custom maxPersistenceTtlMs',
        async () => {
            await using cache = await createCache({
                staleRetention: 'evict',
                maxPersistenceTtlMs: 2_592_000_000,
            });
            const req = new Request('http://localhost/x');
            await cache.put(
                req,
                new Response('hi', {
                    headers: { 'cache-control': 'max-age=3600' },
                }),
            );
            await assertNothingStored(cache, req);
        },
    );
});

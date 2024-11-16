import type {
    CacheHeaderNormalizer,
    CacheLike,
    CachePersistenceConstructable,
    CachePersistenceFactory,
    CachePersistenceLike,
    CacheStorageLike,
} from './types.ts';
import * as webidl from './webidl.ts';
import { Cache } from './cache.ts';
import { CachePersistenceMemory } from './cache-persistence-memory.ts';

/**
 * The storage for Cache objects.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/CacheStorage)
 */
export class CacheStorage implements CacheStorageLike {
    protected _caches: Record<string, [CacheLike, CachePersistenceLike]> =
        Object
            .create(null);
    protected _persistenceFactory: CachePersistenceFactory;

    constructor(
        factoryOrCtor: CachePersistenceFactory | CachePersistenceConstructable =
            CachePersistenceMemory,
        protected _normalizeHeader: CacheHeaderNormalizer = (_, v) => v,
    ) {
        if (typeof factoryOrCtor === 'function') {
            // Normalize to a factory
            this._persistenceFactory = {
                async create() {
                    return new factoryOrCtor();
                },
            };
        } else {
            this._persistenceFactory = factoryOrCtor;
        }
    }

    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/CacheStorage/open) */
    async open(cacheName: string): Promise<CacheLike> {
        const prefix = "Failed to execute 'open' on 'CacheStorage'";
        webidl.requiredArguments(arguments.length, 1, prefix);
        const existingCache = this._caches[cacheName];
        if (existingCache) {
            return existingCache[0];
        }
        const persistence = await this._persistenceFactory.create(cacheName);
        const cache = new Cache(cacheName, persistence, this._normalizeHeader);
        this._caches[cacheName] = [cache, persistence];
        return cache;
    }

    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/CacheStorage/has) */
    async has(cacheName: string): Promise<boolean> {
        const prefix = "Failed to execute 'has' on 'CacheStorage'";
        webidl.requiredArguments(arguments.length, 1, prefix);
        return cacheName in this._caches;
    }

    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/CacheStorage/delete) */
    async delete(cacheName: string): Promise<boolean> {
        const prefix = "Failed to execute 'delete' on 'CacheStorage'";
        webidl.requiredArguments(arguments.length, 1, prefix);
        const existingCache = this._caches[cacheName];
        if (!existingCache) {
            return false;
        }
        for await (
            const [request, response] of existingCache[1][Symbol.asyncIterator](
                cacheName,
            )
        ) {
            await existingCache[1].delete(cacheName, request, response);
        }
        await existingCache[1][Symbol.asyncDispose]?.(cacheName);
        delete this._caches[cacheName];
        return true;
    }

    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/CacheStorage/keys) */
    async keys(): Promise<string[]> {
        return Object.keys(this._caches);
    }

    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/CacheStorage/match) */
    async match(
        request: RequestInfo | URL,
        options?: CacheQueryOptions,
    ): Promise<Response | undefined> {
        for (const cacheName of await this.keys()) {
            const cache = await this.open(cacheName);
            const response = await cache.match(request, options);
            if (response) {
                return response;
            }
        }
    }
}

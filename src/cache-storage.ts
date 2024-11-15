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

export class CacheStorage implements CacheStorageLike {
    protected _cache: Record<string, [CacheLike, CachePersistenceLike]> = Object
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

    async open(cacheName: string): Promise<CacheLike> {
        const prefix = "Failed to execute 'open' on 'CacheStorage'";
        webidl.requiredArguments(arguments.length, 1, prefix);
        const existingCache = this._cache[cacheName];
        if (existingCache) {
            return existingCache[0];
        }
        const persistence = await this._persistenceFactory.create(cacheName);
        const cache = new Cache(cacheName, persistence, this._normalizeHeader);
        this._cache[cacheName] = [cache, persistence];
        return cache;
    }

    async has(cacheName: string): Promise<boolean> {
        const prefix = "Failed to execute 'has' on 'CacheStorage'";
        webidl.requiredArguments(arguments.length, 1, prefix);
        return cacheName in this._cache;
    }

    async delete(cacheName: string): Promise<boolean> {
        const prefix = "Failed to execute 'delete' on 'CacheStorage'";
        webidl.requiredArguments(arguments.length, 1, prefix);
        const existingCache = this._cache[cacheName];
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
        await existingCache[0][Symbol.asyncDispose]?.();
        delete this._cache[cacheName];
        return true;
    }

    keys(): string[] {
        return Object.keys(this._cache);
    }
}

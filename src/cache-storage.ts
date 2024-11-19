import type {
    CacheHeaderNormalizer,
    CacheLike,
    CacheLikeConstructable,
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
    protected _openedCaches: string[] = [];
    protected _persistenceFactory: CachePersistenceFactory;

    constructor(
        persistenceFactoryOrCtor:
            | CachePersistenceFactory
            | CachePersistenceConstructable =
                (function defaultPresistenceFactory() {
                    let persistence: CachePersistenceLike;
                    return {
                        async create() {
                            if (!persistence) {
                                persistence = new CachePersistenceMemory();
                            }
                            return persistence;
                        },
                    };
                })(),
        protected _headerNormalizer: CacheHeaderNormalizer = (_, v) => v,
        protected _CacheCtor: CacheLikeConstructable = Cache,
    ) {
        if (typeof persistenceFactoryOrCtor === 'function') {
            // Normalize to a factory
            this._persistenceFactory = {
                async create() {
                    return new persistenceFactoryOrCtor();
                },
            };
        } else {
            this._persistenceFactory = persistenceFactoryOrCtor;
        }
    }

    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/CacheStorage/open) */
    async open(cacheName: string): Promise<CacheLike> {
        const prefix = "Failed to execute 'open' on 'CacheStorage'";
        webidl.requiredArguments(arguments.length, 1, prefix);
        const persistence = await this._persistenceFactory.create();
        const cache = new this._CacheCtor(
            cacheName,
            persistence,
            this._headerNormalizer,
        );
        if (!this._openedCaches.includes(cacheName)) {
            this._openedCaches.push(cacheName);
        }
        return cache;
    }

    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/CacheStorage/has) */
    async has(cacheName: string): Promise<boolean> {
        const prefix = "Failed to execute 'has' on 'CacheStorage'";
        webidl.requiredArguments(arguments.length, 1, prefix);
        return (await this.keys()).includes(cacheName);
    }

    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/CacheStorage/delete) */
    async delete(cacheName: string): Promise<boolean> {
        const prefix = "Failed to execute 'delete' on 'CacheStorage'";
        webidl.requiredArguments(arguments.length, 1, prefix);
        if (!(await this.has(cacheName))) {
            return false;
        }
        await using cache = await this.open(cacheName);
        for (const request of await cache.keys()) {
            await cache.delete(request, {
                ignoreMethod: true,
                ignoreSearch: true,
                ignoreVary: true,
            });
        }
        this._openedCaches.splice(
            this._openedCaches.findIndex((v) => v === cacheName),
            1,
        );
        return true;
    }

    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/CacheStorage/keys) */
    async keys(): Promise<string[]> {
        const persistence = await this._persistenceFactory.create();
        const allCacheNames = await persistence.keys();
        await persistence[Symbol.asyncDispose]?.();
        for (const openedCacheName of this._openedCaches) {
            if (!allCacheNames.includes(openedCacheName)) {
                allCacheNames.push(openedCacheName);
            }
        }
        return allCacheNames;
    }

    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/CacheStorage/match) */
    async match(
        request: RequestInfo | URL,
        options?: CacheQueryOptions,
    ): Promise<Response | undefined> {
        for (const cacheName of await this.keys()) {
            await using cache = await this.open(cacheName);
            const response = await cache.match(request, options);
            if (response) {
                return response;
            }
        }
    }
}

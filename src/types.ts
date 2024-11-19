import { type RedisConnectOptions } from 'redis';
import { type Options as PoolOptions } from 'generic-pool';

/**
 * Provides a persistence mechanism to be used by the Cache object.
 */
export interface CachePersistenceLike {
    /**
     * The keys() method of the CachePersistence interface fulfills a similar role
     * to the keys() method of the CacheStorage object. The persistence layer has
     * to return the cache names for which it currently stores Request/Response pairs.
     *
     * [MDN Reference](https://developer.mozilla.org/docs/Web/API/CacheStorage/keys)
     */
    keys(): Promise<string[]>;

    /**
     * The put() method of the CachePersistence interface is used by the
     * Cache object to store Request/Response pairs.
     *
     * The method responsability is limited to store the pair for latter usage.
     * Therefore, It should not perform checks on the given Request/Response objects.
     *
     * The specific implementations should decide the best way to perform
     * the storage operation, taking into account that for a given request
     * more than one response can exist.
     */
    put(
        cacheName: string,
        request: Request,
        response: Response,
    ): Promise<boolean>;

    /**
     * The delete() method of the CachePersistence interface is used by the
     * Cache object to delete an existing Request/Response pair, or all the
     * pairs associated the the same Request key.
     */
    delete(
        cacheName: string,
        request: Request,
        response?: Response,
    ): Promise<boolean>;

    /**
     * The get() method of the CachePersistence interface finds the entry whose key
     * is the request, and returns an async iterator that yields all the
     * Request/Response pairs associated to the key, one at a time.
     */
    get(
        cacheName: string,
        request: Request,
    ): AsyncGenerator<readonly [Request, Response], void, unknown>;

    /**
     * The [[Symbol.asyncIterator]] method of the CachePersistence interface returns
     * an async iterator that yields all the existing Request/Response pairs.
     * The pairs are returned in the order that they were inserted, that is older
     * pairs are yielded first.
     */
    [Symbol.asyncIterator](cacheName: string): AsyncGenerator<
        readonly [Request, Response],
        void,
        unknown
    >;

    /**
     * The [[Symbol.asyncDispose]] optional method of the CachePersistence interface
     * may be used to dispose internal resources used by the specific implementations.
     *
     * It will be called automatically if you open a Cache object with the using keyword.
     *
     * @example
     * ```ts
     * {
     *   await using cache = caches.open('v1');
     * }
     * // when leaving the scope CachePersistence[[Symbol.asyncDisponse]] will be called
     * ```
     *
     * It will NOT be called when the delete() method of the CacheStorage object is called.
     * CacheStorage delete() method remove existing pairs, however it can't dispose arbitrary
     * existing CachePersistence instances.
     */
    [Symbol.asyncDispose]?(): Promise<void>;
}

/**
 * A constructable that returns a CachePersistence specific implementation.
 */
export interface CachePersistenceConstructable {
    new (): CachePersistenceLike;
}

/**
 * A factory that creates a CachePersistence specific implementation.
 * This option is more flexible than passing a simple constructable.
 */
export interface CachePersistenceFactory {
    create(): Promise<CachePersistenceLike>;
}

/**
 * Provides a storage mechanism for Request/Response object pairs to be cached.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Cache)
 */
export interface CacheLike extends Cache {
    /**
     * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Cache/add)
     *
     * Note: this method is not implemented in Deno built-in Cache objects.
     */
    add(request: RequestInfo | URL): Promise<undefined>;

    /**
     * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Cache/addAll)
     *
     * Note: this method is not implemented in Deno built-in Cache objects.
     */
    addAll(requests: Array<RequestInfo | URL>): Promise<undefined>;

    /**
     * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Cache/delete)
     */
    delete(
        request: RequestInfo | URL,
        options?: CacheQueryOptions,
    ): Promise<boolean>;

    /**
     * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Cache/keys)
     *
     * Note: this method is not implemented in Deno built-in Cache objects.
     */
    keys(
        request?: RequestInfo | URL,
        options?: CacheQueryOptions,
    ): Promise<ReadonlyArray<Request>>;

    /**
     * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Cache/match)
     */
    match(
        request: RequestInfo | URL,
        options?: CacheQueryOptions,
    ): Promise<Response | undefined>;

    /**
     * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Cache/matchAll)
     *
     * Note: this method is not implemented in Deno built-in Cache objects.
     */
    matchAll(
        request?: RequestInfo | URL,
        options?: CacheQueryOptions,
    ): Promise<ReadonlyArray<Response>>;

    /**
     * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Cache/put)
     */
    put(request: RequestInfo | URL, response: Response): Promise<void>;

    /**
     * Allows to use `await using` when calling CacheStorage open() method.
     *
     * Note: this method is not part of the W3C standard.
     */
    [Symbol.asyncDispose](): Promise<void>;
}

/**
 * The storage for Cache objects.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/CacheStorage)
 */
export interface CacheStorageLike extends CacheStorage {
    /**
     * [MDN Reference](https://developer.mozilla.org/docs/Web/API/CacheStorage/delete)
     */
    delete(cacheName: string): Promise<boolean>;

    /**
     * [MDN Reference](https://developer.mozilla.org/docs/Web/API/CacheStorage/has)
     */
    has(cacheName: string): Promise<boolean>;

    /**
     * [MDN Reference](https://developer.mozilla.org/docs/Web/API/CacheStorage/keys)
     *
     * Note: this method is not implemented in Deno built-in Cache objects.
     */
    keys(): Promise<string[]>;

    /**
     * [MDN Reference](https://developer.mozilla.org/docs/Web/API/CacheStorage/match)
     *
     * Note: this method is not implemented in Deno built-in Cache objects.
     */
    match(
        request: RequestInfo | URL,
        options?: CacheQueryOptions,
    ): Promise<Response | undefined>;

    /**
     * [MDN Reference](https://developer.mozilla.org/docs/Web/API/CacheStorage/open)
     *
     * Note: this declaration differs from the standard just to specify the return value.
     */
    open(cacheName: string): Promise<CacheLike>;
}

export interface CacheLikeConstructable {
    new (
        cacheName: string,
        persistence: CachePersistenceLike,
        headerNormalizer: CacheHeaderNormalizer,
    ): CacheLike;
}

export interface CacheStorageLikeConstructable {
    new (
        factoryOrCtor: CachePersistenceFactory | CachePersistenceConstructable,
        headerNormalizer?: CacheHeaderNormalizer,
        CacheCtor?: CacheLikeConstructable,
    ): CacheStorageLike;
}

export interface CacheHeaderNormalizer {
    (headerName: string, headerValue: string | null): string | null;
}

export type PlainReq = {
    reqUrl: string;
    reqMethod: string;
    reqHeaders: Array<string[]>;
};
export type PlainRes = {
    resHeaders: Array<string[]>;
    resStatus: string;
    resStatusText: string;
    resBody?: Uint8Array;
};
export type PlainReqResMeta = {
    /** ULID */
    id: string;
    /** The ES Epoch when the cached response expires */
    expires: string;
    /**
     * The ES Epoch when this cached pair got created,
     * plus an additional counter to deambiguate ordering of same
     * millisecond creations. Example value: `"1731871697165-0"`
     */
    created: string;
};
export type PlainReqRes =
    & PlainReq
    & PlainRes
    & PlainReqResMeta;

export interface CachePersistenceBaseOptions {
    compress?: boolean;
}

export interface CachePersistenceMemoryOptions
    extends CachePersistenceBaseOptions {}

export interface CachePersistenceRedisOptions
    extends RedisConnectOptions, PoolOptions, CachePersistenceBaseOptions {
    keysLimit?: number;
}

export interface DenoKvOpenOptions {
    path?: string | undefined;
}

export interface CachePersistenceDenoKvOptions
    extends DenoKvOpenOptions, PoolOptions, CachePersistenceBaseOptions {}

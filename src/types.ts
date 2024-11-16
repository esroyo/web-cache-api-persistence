import type { SimplifyDeep } from 'npm:type-fest';
import { type RedisConnectOptions } from 'redis';
import { type Options as PoolOptions } from 'generic-pool';

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
    id: string;
    /** The ES Epoch when this resource expires */
    expires: string;
    /** The ES Epoch when this resource got created */
    created: string;
};
export type PlainReqRes =
    & PlainReq
    & PlainRes
    & PlainReqResMeta;

export interface CachePersistenceLike {
    put(
        cacheName: string,
        request: Request,
        response: Response,
    ): Promise<boolean>;
    delete(
        cacheName: string,
        request: Request,
        response?: Response,
    ): Promise<boolean>;
    get(
        cacheName: string,
        request: Request,
    ): AsyncGenerator<readonly [Request, Response], void, unknown>;
    [Symbol.asyncIterator](cacheName: string): AsyncGenerator<
        readonly [Request, Response],
        void,
        unknown
    >;
    [Symbol.asyncDispose]?(cacheName: string): Promise<void>;
}

export interface CachePersistenceConstructable {
    new (...args: any[]): CachePersistenceLike;
}

export interface CachePersistenceFactory {
    create(cacheName: string): Promise<CachePersistenceLike>;
}

/**
 * Provides a storage mechanism for Request / Response object pairs that are cached, for example as part of the ServiceWorker life cycle. Note that the Cache interface is exposed to windowed scopes as well as workers. You don't have to use it in conjunction with service workers, even though it is defined in the service worker spec.
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Cache)
 */
export interface CacheLike extends Cache {
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Cache/add) */
    add(request: RequestInfo | URL): Promise<undefined>;
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Cache/addAll) */
    addAll(requests: Array<RequestInfo | URL>): Promise<undefined>;
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Cache/keys) */
    keys(
        request?: RequestInfo | URL,
        options?: CacheQueryOptions,
    ): Promise<ReadonlyArray<Request>>;
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Cache/matchAll) */
    matchAll(
        request?: RequestInfo | URL,
        options?: CacheQueryOptions,
    ): Promise<ReadonlyArray<Response>>;
}

/**
 * The storage for Cache objects.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/CacheStorage)
 */
export interface CacheStorageLike extends CacheStorage {
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/CacheStorage/open) */
    open(cacheName: string): Promise<CacheLike>;
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/CacheStorage/keys) */
    keys(): Promise<string[]>;
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/CacheStorage/match) */
    match(
        request: RequestInfo | URL,
        options?: CacheQueryOptions,
    ): Promise<Response | undefined>;
}

export interface CacheStorageConstructable {
    new (
        factoryOrCtor: CachePersistenceFactory | CachePersistenceConstructable,
    ): CacheStorageLike;
}

export interface CacheHeaderNormalizer {
    (headerName: string, headerValue: string | null): string | null;
}

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

// type Foo = SimplifyDeep<CacheLike>;
// type Bar = SimplifyDeep<CacheStorageLike>;

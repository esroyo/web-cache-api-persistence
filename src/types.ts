import { type RedisConnectOptions } from 'redis';
import { type Options as PoolOptions } from 'generic-pool';

export type PlainReq = {
    reqUrl: string;
    reqBody?: Uint8Array;
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

export interface CacheLike extends Cache {
    matchAll(
        request?: RequestInfo | URL,
        options?: CacheQueryOptions,
    ): Promise<readonly Response[]>;
    [Symbol.asyncDispose](): Promise<void>;
}

export interface CacheStorageLike extends CacheStorage {
    open(cacheName: string): Promise<CacheLike>;
    keys(): string[];
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
    extends RedisConnectOptions, PoolOptions, CachePersistenceBaseOptions {}

export interface DenoKvOpenOptions {
    path?: string | undefined;
}

export interface CachePersistenceDenoKvOptions
    extends DenoKvOpenOptions, PoolOptions, CachePersistenceBaseOptions {}

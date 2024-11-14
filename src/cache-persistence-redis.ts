import { createPool, type Pool } from 'generic-pool';
import msgpack from 'msgpack-lite';
import { connect, type Redis } from 'redis';
import type {
    CachePersistenceLike,
    CachePersistenceRedisOptions,
    PlainReqRes,
} from './types.ts';
import { CachePersistenceBase } from './cache-persistence-base.ts';
import * as webidl from './webidl.ts';

export class CachePersistenceRedis extends CachePersistenceBase
    implements CachePersistenceLike {
    protected _defaultOptions: CachePersistenceRedisOptions = {
        // Redis defaults
        hostname: '127.0.0.1',
        port: '6379',
        // Pool defaults
        max: 4,
        min: 2,
        testOnBorrow: true,
        // Custom
        compress: false,
    };
    protected _options: CachePersistenceRedisOptions;
    protected _redisPool: Pool<Redis>;
    protected _msgpackCodec = msgpack.createCodec({
        uint8array: true,
        preset: true,
    });

    constructor(options?: CachePersistenceRedisOptions) {
        super();
        this._options = { ...this._defaultOptions, ...options };
        this._redisPool = createPool<Redis>({
            create: async () => connect(this._options),
            destroy: async (client) => client.close(),
            validate: async (client) => {
                if (!client.isConnected) {
                    await client.connect();
                }
                return true;
            },
        }, this._options);
    }

    async put(
        cacheName: string,
        request: Request,
        response: Response,
    ): Promise<boolean> {
        const expiresIn = this._expiresIn(response);
        if (expiresIn <= 0) {
            return false;
        }

        const [plainReq, plainRes] = await Promise.all([
            this._requestToPlain(request),
            this._responseToPlain(response),
        ]);
        const created = this._created();
        const plainReqRes = {
            created: created.join('-'),
            expires: String(created[0] + expiresIn),
            id: await this._randomId(),
            ...plainReq,
            ...plainRes,
        };

        const persistenceKey = await this._persistenceKey(
            cacheName,
            plainReqRes,
        );

        await this._redisSet(
            persistenceKey,
            plainReqRes,
            expiresIn,
        );

        return true;
    }

    async delete(
        cacheName: string,
        request: Request,
        response?: Response,
    ): Promise<boolean> {
        if (!response) {
            const persistenceKey = await this._persistenceKey(
                cacheName,
                request,
            );
            const toDelete: string[] = [];
            for await (const key of this._redisKeys(persistenceKey)) {
                // WARN: do not remove while iterating with _redisKeys
                toDelete.push(key);
            }
            return await this._redisDel(...toDelete);
        }

        const persistenceKey = await this._persistenceKey(
            cacheName,
            request,
            response,
        );
        return await this._redisDel(persistenceKey);
    }

    async *get(
        cacheName: string,
        request: Request,
    ): AsyncGenerator<readonly [Request, Response], void, unknown> {
        const persistenceKey = await this._persistenceKey(cacheName, request);
        for await (const key of this._redisKeys(persistenceKey)) {
            const plainReqRes = await this._redisGet(key);
            if (!plainReqRes) {
                continue;
            }
            if (this._hasExpired(plainReqRes)) {
                continue;
            }
            yield [
                this._plainToRequest(plainReqRes),
                this._plainToResponse(plainReqRes),
            ] as const;
        }
    }

    [Symbol.asyncIterator](
        cacheName: string,
    ): AsyncGenerator<readonly [Request, Response], void, unknown> {
        const prefix =
            "Failed to execute '[[Symbol.asyncIterator]]' on 'CachePersistence'";
        webidl.requiredArguments(arguments.length, 1, prefix);
        const instance = this;
        let persistenceKey: string[] = [];
        return (async function* () {
            persistenceKey = await instance._persistenceKey(cacheName);
            const keys = await instance._redisScan([...persistenceKey, '*']);
            for (const key of keys) {
                const plainReqRes = await instance._redisGet(key);
                if (!plainReqRes) {
                    continue;
                }
                yield [
                    instance._plainToRequest(plainReqRes),
                    instance._plainToResponse(plainReqRes),
                ] as const;
            }
        })();
    }

    async [Symbol.asyncDispose](_cacheName: string): Promise<void> {
        await this._redisPool.drain();
        await this._redisPool.clear();
    }

    protected async _redisScan(pattern: string[]): Promise<string[]> {
        const found = [];
        let cursor = '0';
        const persistenceKey = this._joinKey(pattern);
        const redis = await this._redisPool.acquire();
        do {
            const reply = await redis.scan(+cursor, {
                pattern: persistenceKey,
                type: 'string',
                count: 100_000,
            });
            cursor = reply[0];
            found.push(...reply[1]);
        } while (cursor !== '0');
        await this._redisPool.release(redis);
        found.sort().reverse();
        return found;
    }

    protected async *_redisKeys(
        key: string[],
    ): AsyncGenerator<string, void, unknown> {
        const indexKey = this._indexKey(key);
        const count = 1;
        let offset = 0;
        let result: string[] = [];
        do {
            const redis = await this._redisPool.acquire();
            result = (await redis.sendCommand('ZRANGE', [
                indexKey,
                '+inf',
                '-inf',
                'BYSCORE',
                'REV',
                'LIMIT',
                offset,
                count,
            ]) as string[]) ?? [];
            await this._redisPool.release(redis);
            if (result.length) {
                offset += result.length;
                for (const key of result) {
                    yield key;
                }
            }
        } while (result.length);
    }

    protected async _redisGet(
        key: string[] | string,
    ): Promise<PlainReqRes | null> {
        const persistenceKey = Array.isArray(key) ? this._joinKey(key) : key;
        const redis = await this._redisPool.acquire();
        const result = await redis.sendCommand('GET', [persistenceKey], {
            returnUint8Arrays: true,
        }) as Uint8Array;
        await this._redisPool.release(redis);
        if (!result) {
            return null;
        }
        return this._parse(result) as PlainReqRes;
    }

    protected async _redisDel(
        ...keys: Array<string[] | string>
    ): Promise<boolean> {
        const redis = await this._redisPool.acquire();
        const tx = redis.pipeline();
        for (const key of keys) {
            const persistenceKey = Array.isArray(key)
                ? this._joinKey(key)
                : key;
            const indexKey = this._indexKey(key);
            tx.del(persistenceKey);
            tx.zrem(indexKey, persistenceKey);
        }
        const result = await tx.flush();
        await this._redisPool.release(redis);
        return result.length && result[0] ? true : false;
    }

    protected async _redisSet(
        key: string[],
        value: PlainReqRes,
        expiresIn: number,
    ): Promise<void> {
        const effectiveKey = this._joinKey(key);
        const created = value.created.split('-');
        const indexKey = this._indexKey(key);
        const redis = await this._redisPool.acquire();
        const tx = redis.tx();
        tx.set(effectiveKey, this._serialize(value));
        tx.pexpire(effectiveKey, expiresIn);
        tx.zadd(indexKey, +(+created[0] * 1000 + created[1]), effectiveKey);
        tx.pexpire(indexKey, this._defaultExpireIn);
        await tx.flush();
        await this._redisPool.release(redis);
    }

    protected _indexKey(
        key: string[] | string,
    ): string {
        const splitKey = Array.isArray(key) ? key : this._splitKey(key);
        return this._joinKey(splitKey.slice(0, 3));
    }

    protected _serialize(plainReqRes: PlainReqRes): Uint8Array {
        if (this._options.compress) {
            return msgpack.encode(plainReqRes, { codec: this._msgpackCodec });
        }
        return this._encoder.encode(JSON.stringify({
            ...plainReqRes,
            ...(plainReqRes.reqBody &&
                { reqBody: this._decoder.decode(plainReqRes.reqBody) }),
            ...(plainReqRes.resBody &&
                { resBody: this._decoder.decode(plainReqRes.resBody) }),
        }));
    }

    protected _parse(serializedPlainReqRes: Uint8Array): PlainReqRes {
        if (this._options.compress) {
            return msgpack.decode(serializedPlainReqRes, {
                codec: this._msgpackCodec,
            });
        }
        const plainReqRes = JSON.parse(
            this._decoder.decode(serializedPlainReqRes),
        ) as PlainReqRes;
        if (plainReqRes.reqBody) {
            plainReqRes.reqBody = this._encoder.encode(
                plainReqRes.reqBody as unknown as string,
            );
        }
        if (plainReqRes.resBody) {
            plainReqRes.resBody = this._encoder.encode(
                plainReqRes.resBody as unknown as string,
            );
        }
        return plainReqRes;
    }
}

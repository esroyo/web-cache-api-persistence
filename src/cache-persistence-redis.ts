import { createPool, type Pool } from 'generic-pool';
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
    protected override _options: CachePersistenceRedisOptions;
    protected _dbPool: Pool<Redis>;
    protected override get _defaultOptions(): CachePersistenceRedisOptions {
        return {
            ...super._defaultOptions,
            // Redis defaults
            hostname: '127.0.0.1',
            port: '6379',
            // Pool defaults
            max: 4,
            min: 2,
            testOnBorrow: true,
            // Custom options
            keysLimit: 4,
        };
    }

    constructor(options?: CachePersistenceRedisOptions) {
        super();
        this._options = { ...this._defaultOptions, ...options };
        this._dbPool = createPool<Redis>({
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

    /**
     * @inheritdoc
     */
    async keys(): Promise<string[]> {
        const cacheNames = new Set<string>();
        const persistenceKey = (await this._persistenceKey('*')).concat('*');
        for (const key of await this._dbScan(persistenceKey)) {
            cacheNames.add(this._splitKey(key)[1]);
        }
        return [...cacheNames];
    }

    async put(
        cacheName: string,
        request: Request,
        response: Response,
    ): Promise<boolean> {
        const pair = await this._pairToPlain(request, response);

        if (!pair) {
            return false;
        }

        const [plainReqRes, expiresIn] = pair;

        const persistenceKey = await this._persistenceKey(
            cacheName,
            plainReqRes,
        );

        await this._dbSet(
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
            for await (const key of this._dbKeys(persistenceKey)) {
                // WARN: do not remove while iterating with _dbKeys
                toDelete.push(key);
            }
            return await this._dbDel(...toDelete);
        }

        const persistenceKey = await this._persistenceKey(
            cacheName,
            request,
            response,
        );

        return await this._dbDel(persistenceKey);
    }

    async *get(
        cacheName: string,
        request: Request,
    ): AsyncGenerator<readonly [Request, Response], void, unknown> {
        const persistenceKey = await this._persistenceKey(cacheName, request);
        for await (const key of this._dbKeys(persistenceKey)) {
            const plainReqRes = await this._dbGet(key);
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
        return (async function* () {
            const persistenceKey = await instance._persistenceKey(cacheName);
            const keys = await instance._dbScan([...persistenceKey, '*']);
            for (const key of keys) {
                const plainReqRes = await instance._dbGet(key);
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

    async [Symbol.asyncDispose](): Promise<void> {
        await this._dbPool.drain();
        await this._dbPool.clear();
    }

    protected async _dbScan(pattern: string[]): Promise<string[]> {
        const indexes = [];
        const found = [];
        let cursor = '0';
        const persistenceKey = this._joinKey(pattern);
        const client = await this._dbPool.acquire();
        do {
            const reply = await client.sendCommand('SCAN', [
                +cursor,
                'MATCH',
                persistenceKey,
                'COUNT',
                100_000,
                'TYPE',
                'zset',
            ]);
            if (reply && Array.isArray(reply)) {
                cursor = reply[0] as string;
                indexes.push(...reply[1] as string[]);
            }
        } while (cursor !== '0');
        await this._dbPool.release(client);
        for (const index of indexes) {
            for await (
                const key of this._dbKeys(this._splitKey(index), 100_000)
            ) {
                found.push(this._splitKey(key));
            }
        }
        return found.sort().map((key) => this._joinKey(key));
    }

    protected async *_dbKeys(
        key: string[],
        keysLimit = this._options.keysLimit,
    ): AsyncGenerator<string, void, unknown> {
        const indexKey = this._indexKey(key);
        const count = Math.max(keysLimit ?? 0, 1);
        let offset = 0;
        let result: string[] = [];
        do {
            const client = await this._dbPool.acquire();
            result = (await client.sendCommand('ZRANGE', [
                indexKey,
                '-inf',
                '+inf',
                'BYSCORE',
                'LIMIT',
                offset,
                count,
            ]) as string[]) ?? [];
            await this._dbPool.release(client);
            if (result.length) {
                offset += result.length;
                for (const key of result) {
                    yield key;
                }
            }
        } while (result.length);
    }

    protected async _dbGet(
        key: string[] | string,
    ): Promise<PlainReqRes | null> {
        const persistenceKey = Array.isArray(key) ? this._joinKey(key) : key;
        const client = await this._dbPool.acquire();
        const result = await client.sendCommand('GET', [persistenceKey], {
            returnUint8Arrays: true,
        }) as Uint8Array;
        await this._dbPool.release(client);
        if (!result) {
            await this._dbDel(key);
            return null;
        }
        return this._parse(result) as PlainReqRes;
    }

    protected async _dbDel(
        ...keys: Array<string[] | string>
    ): Promise<boolean> {
        const client = await this._dbPool.acquire();
        const tx = client.tx();
        for (const key of keys) {
            const persistenceKey = Array.isArray(key)
                ? this._joinKey(key)
                : key;
            const indexKey = this._indexKey(key);
            tx.sendCommand('DEL', [persistenceKey]);
            tx.sendCommand('ZREM', [indexKey, persistenceKey]);
        }
        const result = await tx.flush();
        await this._dbPool.release(client);
        return result.length && result[0] ? true : false;
    }

    protected async _dbSet(
        key: string[],
        value: PlainReqRes,
        expiresIn: number,
    ): Promise<void> {
        const effectiveKey = this._joinKey(key);
        const created = value.created.split('-');
        const indexKey = this._indexKey(key);
        const client = await this._dbPool.acquire();
        const tx = client.tx();
        tx.sendCommand('SET', [effectiveKey, this._serialize(value)]);
        tx.sendCommand('PEXPIRE', [effectiveKey, expiresIn]);
        tx.sendCommand('ZADD', [
            indexKey,
            +(+created[0] * 1000 + created[1]),
            effectiveKey,
        ]);
        tx.sendCommand('PEXPIRE', [
            indexKey,
            Math.min(expiresIn, this._maxExpireIn),
            'GT',
        ]);
        await tx.flush();
        await this._dbPool.release(client);
    }

    protected _indexKey(
        key: string[] | string,
    ): string {
        const splitKey = Array.isArray(key) ? key : this._splitKey(key);
        return this._joinKey(splitKey.slice(0, 3));
    }
}

import { createPool, type Pool } from 'generic-pool';
import { get as kvToolboxGet } from '@kitsonk/kv-toolbox/blob';
import { batchedAtomic } from '@kitsonk/kv-toolbox/batched_atomic';

import type {
    CachePersistenceDenoKvOptions,
    CachePersistenceLike,
    PlainReqRes,
} from './types.ts';
import { CachePersistenceBase } from './cache-persistence-base.ts';
import * as webidl from './webidl.ts';

export class CachePersistenceDenoKv extends CachePersistenceBase
    implements CachePersistenceLike {
    protected override _options: CachePersistenceDenoKvOptions;
    protected _dbPool: Pool<Deno.Kv>;
    protected override get _defaultOptions(): CachePersistenceDenoKvOptions {
        return {
            ...super._defaultOptions,
            // Pool defaults
            max: 1,
            min: 1,
        };
    }

    constructor(options?: CachePersistenceDenoKvOptions) {
        super();
        this._options = { ...this._defaultOptions, ...options };
        this._dbPool = createPool<Deno.Kv>({
            create: async () => Deno.openKv(this._options.path),
            destroy: async (kv) => {
                kv.close();
            },
        }, this._options);
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
            const keys = await this._dbKeys(persistenceKey);
            let hasDeleted = false;
            for (const key of keys) {
                await this._dbDel(key);
                hasDeleted = true;
            }
            return hasDeleted;
        }

        const persistenceKey = await this._persistenceKey(
            cacheName,
            request,
            response,
        );
        await this._dbDel(persistenceKey);
        return true;
    }

    async *get(
        cacheName: string,
        request: Request,
    ): AsyncGenerator<readonly [Request, Response], void, unknown> {
        const persistenceKey = await this._persistenceKey(cacheName, request);
        const keys = await this._dbKeys(persistenceKey);
        for (const key of keys) {
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
            const keys = await instance._dbScan(persistenceKey);
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

    async [Symbol.asyncDispose](_cacheName: string): Promise<void> {
        await this._dbPool.drain();
        await this._dbPool.clear();
    }

    protected async _dbScan(key: string[]): Promise<string[][]> {
        const client = await this._dbPool.acquire();
        const iter = client.list<string>({ prefix: key });
        const found = [];
        for await (const res of iter) {
            if (res.key.length === 3) { // This is an index (a Set)
                for (const key of res.value) {
                    found.push(this._splitKey(key));
                }
            }
        }
        await this._dbPool.release(client);
        found.sort((a, b) => (a[3] > b[3] ? -1 : 1));
        return found;
    }

    protected async _dbKeys(key: string[]): Promise<string[][]> {
        const indexKey = this._indexKey(key);
        const client = await this._dbPool.acquire();
        const indexRes = await client.get<Set<string>>(indexKey);
        await this._dbPool.release(client);
        if (!indexRes.value) {
            return [];
        }
        const found = [...indexRes.value]
            .sort()
            .reverse()
            .map((key) => this._splitKey(key));
        return found;
    }

    protected async _dbGet(key: string[]): Promise<PlainReqRes | null> {
        const client = await this._dbPool.acquire();
        const result = await kvToolboxGet(client, key, {
            consistency: 'eventual',
        });
        await this._dbPool.release(client);
        if (!result.value) {
            await this._dbDel(key);
            return null;
        }
        return this._parse(result.value as Uint8Array) as PlainReqRes;
    }

    protected async _dbDel(key: string[]): Promise<void> {
        const indexKey = this._indexKey(key);
        const client = await this._dbPool.acquire();
        const indexRes = await client.get<Set<string>>(indexKey);
        const index = indexRes.value || new Set<string>();
        index.delete(this._joinKey(key));
        const op = batchedAtomic(client)
            .check(indexRes)
            .deleteBlob(key);
        if (index.size) {
            op.set(indexKey, index, { expireIn: this._defaultExpireIn });
        } else {
            op.delete(indexKey);
        }
        await op.commit();
        await this._dbPool.release(client);
    }

    protected async _dbSet(
        key: string[],
        value: PlainReqRes,
        expireIn: number,
    ): Promise<void> {
        const indexKey = this._indexKey(key);
        const client = await this._dbPool.acquire();
        const indexRes = await client.get<Set<string>>(indexKey);
        const index = indexRes.value || new Set<string>();
        index.add(this._joinKey(key));
        await batchedAtomic(client)
            .check(indexRes)
            .set(indexKey, index, { expireIn: this._defaultExpireIn })
            .setBlob(key, this._serialize(value), { expireIn })
            .commit();
        await this._dbPool.release(client);
    }

    protected _indexKey(
        key: string[],
    ): string[] {
        return key.slice(0, 3);
    }
}

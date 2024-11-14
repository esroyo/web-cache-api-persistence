import { createPool, type Pool } from 'generic-pool';
import msgpack from 'msgpack-lite';
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
    protected _defaultOptions: CachePersistenceDenoKvOptions = {
        // Pool defaults
        max: 1,
        min: 1,
        // Custom
        compress: false,
    };
    protected _options: CachePersistenceDenoKvOptions;
    protected _kvPool: Pool<Deno.Kv>;
    protected _msgpackCodec = msgpack.createCodec({
        uint8array: true,
        preset: true,
    });

    constructor(options?: CachePersistenceDenoKvOptions) {
        super();
        this._options = { ...this._defaultOptions, ...options };
        this._kvPool = createPool<Deno.Kv>({
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

        await this._kvSet(
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
            const keys = await this._kvKeys(persistenceKey);
            let hasDeleted = false;
            for (const key of keys) {
                await this._kvDel(key);
                hasDeleted = true;
            }
            return hasDeleted;
        }

        const persistenceKey = await this._persistenceKey(
            cacheName,
            request,
            response,
        );
        await this._kvDel(persistenceKey);
        return true;
    }

    async *get(
        cacheName: string,
        request: Request,
    ): AsyncGenerator<readonly [Request, Response], void, unknown> {
        const persistenceKey = await this._persistenceKey(cacheName, request);
        const keys = await this._kvKeys(persistenceKey);
        for (const key of keys) {
            const plainReqRes = await this._kvGet(key);
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
            const keys = await instance._kvScan(persistenceKey);
            for (const key of keys) {
                const plainReqRes = await instance._kvGet(key);
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
        await this._kvPool.drain();
        await this._kvPool.clear();
    }

    protected async _kvScan(key: string[]): Promise<string[][]> {
        const kv = await this._kvPool.acquire();
        const iter = kv.list<string>({ prefix: key });
        const found = new Set<string>();
        for await (const res of iter) {
            if (res.key.length >= 4) {
                found.add(this._joinKey(res.key.slice(0, 4) as string[]));
            }
        }
        await this._kvPool.release(kv);
        return [...found]
            .sort()
            .reverse()
            .map((key) => this._splitKey(key));
    }

    protected async _kvKeys(key: string[]): Promise<string[][]> {
        const indexKey = this._indexKey(key);
        const kv = await this._kvPool.acquire();
        const indexRes = await kv.get<Set<string>>(indexKey);
        await this._kvPool.release(kv);
        if (!indexRes.value) {
            return [];
        }
        const found = [...indexRes.value]
            .sort()
            .reverse()
            .map((key) => this._splitKey(key));
        return found;
    }

    protected async _kvGet(key: string[]): Promise<PlainReqRes | null> {
        const kv = await this._kvPool.acquire();
        const result = await kvToolboxGet(kv, key);
        await this._kvPool.release(kv);
        if (!result.value) {
            return null;
        }
        return this._parse(result.value as Uint8Array) as PlainReqRes;
    }

    protected async _kvDel(key: string[]): Promise<void> {
        const indexKey = this._indexKey(key);
        const kv = await this._kvPool.acquire();
        const indexRes = await kv.get<Set<string>>(indexKey);
        const index = indexRes.value || new Set<string>();
        index.delete(this._joinKey(key));
        const op = batchedAtomic(kv)
            .check(indexRes)
            .deleteBlob(key);
        if (index.size) {
            op.set(indexKey, index, { expireIn: this._defaultExpireIn });
        } else {
            op.delete(indexKey);
        }
        await op.commit();
        await this._kvPool.release(kv);
    }

    protected async _kvSet(
        key: string[],
        value: PlainReqRes,
        expireIn: number,
    ): Promise<void> {
        const indexKey = this._indexKey(key);
        const kv = await this._kvPool.acquire();
        const indexRes = await kv.get<Set<string>>(indexKey);
        const index = indexRes.value || new Set<string>();
        index.add(this._joinKey(key));
        await batchedAtomic(kv)
            .check(indexRes)
            .set(indexKey, index, { expireIn: this._defaultExpireIn })
            .setBlob(key, this._serialize(value), { expireIn })
            .commit();
        await this._kvPool.release(kv);
    }

    protected _indexKey(
        key: string[],
    ): string[] {
        return key.slice(0, 3);
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

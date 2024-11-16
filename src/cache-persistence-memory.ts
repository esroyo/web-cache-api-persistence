import { CachePersistenceBase } from './cache-persistence-base.ts';
import type {
    CachePersistenceLike,
    CachePersistenceMemoryOptions,
    PlainReqRes,
} from './types.ts';
import * as webidl from './webidl.ts';

export class CachePersistenceMemory extends CachePersistenceBase
    implements CachePersistenceLike {
    protected _storage: Record<string, PlainReqRes | Uint8Array> = Object
        .create(null);
    protected _indexes: Record<string, Set<string>> = Object.create(null);
    protected _timers: Record<string, number> = Object.create(null);
    protected _maxInteger: number = Math.pow(2, 31) - 1;
    protected override _options: CachePersistenceMemoryOptions;

    constructor(options?: CachePersistenceMemoryOptions) {
        super();
        this._options = { ...this._defaultOptions, ...options };
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
                if (await this._dbDel(key)) {
                    hasDeleted = true;
                }
            }
            return hasDeleted;
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
        for (const timer of Object.values(this._timers)) {
            clearTimeout(timer);
        }
    }

    protected async _dbScan(key: string[]): Promise<string[]> {
        const persistenceKey = this._joinKey(key);
        const found = [];
        for (const index in this._indexes) {
            if (index.startsWith(persistenceKey)) {
                for (const key of this._indexes[index]) {
                    found.push(this._splitKey(key));
                }
            }
        }
        found.sort((a, b) => (a[3] > b[3] ? -1 : 1));
        return found.map((key) => this._joinKey(key));
    }

    protected async _dbKeys(key: string[]): Promise<string[]> {
        const persistenceKey = this._joinKey(key);
        const indexKey = this._indexKey(persistenceKey);
        const index = this._indexes[indexKey] || [];
        return [...index].sort().reverse();
    }

    protected async _dbGet(
        key: string[] | string,
    ): Promise<PlainReqRes | null> {
        const persistenceKey = Array.isArray(key) ? this._joinKey(key) : key;
        const maybeSerializedPlainReqRes = this._storage[persistenceKey];
        const plainReqRes = maybeSerializedPlainReqRes instanceof Uint8Array
            ? this._parse(maybeSerializedPlainReqRes)
            : maybeSerializedPlainReqRes;
        return plainReqRes ?? null;
    }

    protected async _dbDel(key: string[] | string): Promise<boolean> {
        const persistenceKey = Array.isArray(key) ? this._joinKey(key) : key;
        const hasDeleted = persistenceKey in this._storage;
        const existingTimer = this._timers[persistenceKey];
        if (existingTimer) {
            clearTimeout(existingTimer);
            delete this._timers[persistenceKey];
        }
        delete this._storage[persistenceKey];
        const indexKey = this._indexKey(key);
        const index = this._indexes[indexKey];
        if (index) {
            index.delete(persistenceKey);
            if (!index.size) {
                delete this._indexes[indexKey];
            }
        }
        return hasDeleted;
    }

    protected async _dbSet(
        key: string[],
        value: PlainReqRes,
        expiresIn: number,
    ): Promise<void> {
        const persistenceKey = this._joinKey(key);
        this._storage[persistenceKey] = this._options.compress
            ? this._serialize(value)
            : value;
        const indexKey = this._indexKey(persistenceKey);
        const index = this._indexes[indexKey] = this._indexes[indexKey] ||
            new Set<string>();
        index.add(persistenceKey);
        this._indexes[indexKey] = index;
        this._scheduleRemoval(persistenceKey, expiresIn);
    }

    protected _indexKey(
        key: string[] | string,
    ): string {
        const splitKey = Array.isArray(key) ? key : this._splitKey(key);
        return this._joinKey(splitKey.slice(0, 3));
    }

    protected _scheduleRemoval(
        persistenceKey: string,
        expiresIn: number,
    ) {
        const existingTimer = this._timers[persistenceKey];
        if (existingTimer) {
            clearTimeout(existingTimer);
        }
        this._timers[persistenceKey] = setTimeout(() => {
            this._dbDel(this._splitKey(persistenceKey));
        }, Math.min(expiresIn, this._maxInteger));
    }
}

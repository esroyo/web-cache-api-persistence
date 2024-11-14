import { CachePersistenceBase } from './cache-persistence-base.ts';
import type { CachePersistenceLike, PlainReqRes } from './types.ts';

export class CachePersistenceMemory extends CachePersistenceBase
    implements CachePersistenceLike {
    protected _storage: Record<string, PlainReqRes> = Object.create(null);
    protected _indexes: Record<string, Set<string>> = Object.create(null);
    protected _timers: Record<string, number> = Object.create(null);
    protected _maxInteger = Math.pow(2, 31) - 1;

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

        await this._memorySet(
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
            const keys = await this._memoryKeys(persistenceKey);
            let hasDeleted = false;
            for (const key of keys) {
                if (await this._memoryDel(key)) {
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

        return await this._memoryDel(persistenceKey);
    }

    async *get(
        cacheName: string,
        request: Request,
    ): AsyncGenerator<readonly [Request, Response], void, unknown> {
        const persistenceKey = await this._persistenceKey(cacheName, request);
        const keys = await this._memoryKeys(persistenceKey);
        for (const key of keys) {
            const plainReqRes = await this._memoryGet(key);
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
        const instance = this;
        let persistenceKey: string[] = [];
        return (async function* () {
            persistenceKey = await instance._persistenceKey(cacheName);
            const keys = await instance._memoryScan(persistenceKey);
            for (const key of keys) {
                const plainReqRes = await instance._memoryGet(key);
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

    protected async _memoryScan(key: string[]): Promise<string[]> {
        const persistenceKey = this._joinKey(key);
        return Object.keys(this._storage)
            .filter((key) => key.startsWith(persistenceKey))
            .sort().reverse();
    }

    protected async _memoryKeys(key: string[]): Promise<string[]> {
        const persistenceKey = this._joinKey(key);
        const indexKey = this._indexKey(persistenceKey);
        const index = this._indexes[indexKey] || [];
        return [...index].sort().reverse();
    }

    protected async _memoryGet(
        key: string[] | string,
    ): Promise<PlainReqRes | null> {
        const persistenceKey = Array.isArray(key) ? this._joinKey(key) : key;
        const plainReqRes = this._storage[persistenceKey];
        return plainReqRes ?? null;
    }

    protected async _memoryDel(key: string[] | string): Promise<boolean> {
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

    protected async _memorySet(
        key: string[],
        value: PlainReqRes,
        expiresIn: number,
    ): Promise<void> {
        const persistenceKey = this._joinKey(key);
        this._storage[persistenceKey] = value;
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
            this._memoryDel(this._splitKey(persistenceKey));
        }, Math.min(expiresIn, this._maxInteger));
    }
}

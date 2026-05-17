import type { Storage } from "unstorage";
import { CachePersistenceBase } from "../core/cache_persistence_base.ts";
import type {
  CachePersistenceBaseOptions,
  CachePersistenceFactory,
  CachePersistenceLike,
  PlainReqRes,
} from "../core/types.ts";
import * as webidl from "../core/webidl.ts";
import * as sorted from "sorted";

export interface CachePersistenceUnstorageOptions
  extends CachePersistenceBaseOptions {
  storage: Storage;
}

export class CachePersistenceUnstorage extends CachePersistenceBase
  implements CachePersistenceLike {
  protected _storage: Storage;
  protected override _options: CachePersistenceUnstorageOptions;

  constructor(options: CachePersistenceUnstorageOptions) {
    super(options);
    this._storage = options.storage;
    this._options = {
      ...this._defaultOptions,
      ...options,
    } as CachePersistenceUnstorageOptions;
  }

  async keys(): Promise<string[]> {
    const cacheNames = new Set<string>();
    for (const key of await this._dbScan("cachestorage:")) {
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
    const asyncIterator = this._dbKeys(persistenceKey);
    let done = false;
    while (!done) {
      const candidateKeys: string[] = [];
      for (let count = 0; count < 1_000 && !done; count += 1) {
        const iteratorResult = await asyncIterator.next();
        if (iteratorResult.value) {
          candidateKeys.push(iteratorResult.value);
        } else {
          done = true;
        }
      }
      const plainReqResList = await this._dbGet(candidateKeys);
      for (const plainReqRes of plainReqResList) {
        if (!plainReqRes) {
          continue;
        }
        const expired = this._hasExpired(plainReqRes);
        if (expired && this._staleRetention === "evict") {
          continue;
        }
        yield [
          this._plainToRequest(plainReqRes),
          this._plainToResponse(plainReqRes, { stale: expired }),
        ] as const;
      }
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
      for (
        const key of await instance._dbScan(
          `cachestorage:${cacheName}:`,
        )
      ) {
        const [plainReqRes] = await instance._dbGet([key]);
        if (!plainReqRes) {
          continue;
        }
        const expired = instance._hasExpired(plainReqRes);
        if (expired && instance._staleRetention === "evict") {
          continue;
        }
        yield [
          instance._plainToRequest(plainReqRes),
          instance._plainToResponse(plainReqRes, { stale: expired }),
        ] as const;
      }
    })();
  }

  [Symbol.asyncDispose](): Promise<void> {
    return Promise.resolve();
  }

  protected async _dbScan(prefix: string): Promise<string[]> {
    const allKeys = await this._storage.getKeys(prefix);
    const found: string[] = [];
    for (const k of allKeys) {
      const parts = this._splitKey(k);
      // old format: 3 segments (cachestorage:name:digest)
      // new format: 3 segments, 3rd suffixed with "_" (cachestorage:name:digest_)
      if (parts.length === 3) {
        const raw = await this._storage.getItemRaw(k);
        if (!raw) {
          continue;
        }
        const entries = this._parseIndex(raw);
        for (const entry of entries) {
          sorted.add(found, entry, this._compareFn);
        }
      }
    }
    return found;
  }

  protected async *_dbKeys(
    key: string[] | string,
  ): AsyncGenerator<string, void, unknown> {
    const indexKey = this._indexKey(key);
    const raw = await this._storage.getItemRaw(indexKey);
    if (!raw) {
      return;
    }
    const entries = this._parseIndex(raw);
    for (const entry of [...entries].sort()) {
      yield entry;
    }
  }

  protected async _dbGet(
    keys: Array<string[] | string>,
  ): Promise<Array<PlainReqRes | null>> {
    const parsed: Array<PlainReqRes | null> = [];
    for (const key of keys) {
      const persistenceKey = Array.isArray(key) ? this._joinKey(key) : key;
      const raw = await this._storage.getItemRaw(persistenceKey);
      if (!raw) {
        await this._dbDel(key);
        parsed.push(null);
      } else {
        parsed.push(this._parse(raw as Uint8Array) as PlainReqRes);
      }
    }
    return parsed;
  }

  protected async _dbDel(
    ...keys: Array<string[] | string>
  ): Promise<boolean> {
    const indexKeys = new Set<string>();
    let hasDeleted = false;

    for (const key of keys) {
      const persistenceKey = Array.isArray(key) ? this._joinKey(key) : key;
      const existing = await this._storage.getItemRaw(persistenceKey);
      if (existing) {
        await this._storage.removeItem(persistenceKey);
        hasDeleted = true;
      }
      indexKeys.add(this._indexKey(key));
    }

    for (const indexKey of indexKeys) {
      const raw = await this._storage.getItemRaw(indexKey);
      if (!raw) {
        continue;
      }
      const entries = this._parseIndex(raw);
      for (const key of keys) {
        const persistenceKey = Array.isArray(key) ? this._joinKey(key) : key;
        entries.delete(persistenceKey);
      }
      if (entries.size > 0) {
        await this._storage.setItemRaw(
          indexKey,
          this._serializeIndex(entries),
        );
      } else {
        await this._storage.removeItem(indexKey);
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
    const data = this._serialize(value);

    await this._storage.setItemRaw(persistenceKey, data, {
      ttl: Math.ceil(this._evictionDelay(expiresIn) / 1000),
    });

    const indexKey = this._indexKey(key);
    const rawIndex = await this._storage.getItemRaw(indexKey);
    const entries = rawIndex ? this._parseIndex(rawIndex) : new Set<string>();
    entries.add(persistenceKey);
    await this._storage.setItemRaw(indexKey, this._serializeIndex(entries));
  }

  protected _indexKey(key: string[] | string): string {
    const splitKey = Array.isArray(key) ? key : this._splitKey(key);
    const prefix = splitKey.slice(0, 3);
    prefix[2] = prefix[2] + "_";
    return this._joinKey(prefix);
  }

  private _serializeIndex(set: Set<string>): Uint8Array {
    return this._encoder.encode(JSON.stringify([...set]));
  }

  private _parseIndex(raw: unknown): Set<string> {
    if (!raw) {
      return new Set();
    }
    const str = raw instanceof Uint8Array
      ? new TextDecoder().decode(raw)
      : String(raw);
    return new Set(JSON.parse(str));
  }
}

export function unstorage(
  options: CachePersistenceUnstorageOptions,
): CachePersistenceFactory {
  return {
    create: () => Promise.resolve(new CachePersistenceUnstorage(options)),
  };
}

export default unstorage;

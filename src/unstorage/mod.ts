import type { Storage } from "unstorage";
import { CachePersistenceBase } from "../core/cache_persistence_base.ts";
import type {
  CachePersistenceBaseOptions,
  CachePersistenceFactory,
  CachePersistenceLike,
  CachePersistenceQueryOptions,
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
    const prefix = this._joinKey(
      (await this._persistenceKey("")).slice(0, -1),
    );
    for (const key of await this._dbScan(prefix)) {
      cacheNames.add(decodeURIComponent(this._splitKey(key)[1]));
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
    options?: CachePersistenceQueryOptions,
  ): AsyncGenerator<readonly [Request, Response], void, unknown> {
    const persistenceKey = await this._persistenceKey(cacheName, request);
    const keys = await this._dbKeys(persistenceKey);
    for (const key of keys) {
      const plainReqRes = await this._dbGet(key);
      if (!plainReqRes) {
        continue;
      }
      const expired = this._hasExpired(plainReqRes);
      if (
        expired && !options?.ignoreRetention && this._staleRetention === "evict"
      ) {
        continue;
      }
      yield [
        this._plainToRequest(plainReqRes),
        this._plainToResponse(plainReqRes, { stale: expired }),
      ] as const;
    }
  }

  [Symbol.asyncIterator](
    cacheName: string,
    options?: CachePersistenceQueryOptions,
  ): AsyncGenerator<readonly [Request, Response], void, unknown> {
    const prefix =
      "Failed to execute '[[Symbol.asyncIterator]]' on 'CachePersistence'";
    webidl.requiredArguments(arguments.length, 1, prefix);
    const instance = this;
    return (async function* () {
      const scanPrefix = instance._joinKey(
        await instance._persistenceKey(cacheName),
      ) + ":";
      for (const key of await instance._dbScan(scanPrefix)) {
        const plainReqRes = await instance._dbGet(key);
        if (!plainReqRes) {
          continue;
        }
        const expired = instance._hasExpired(plainReqRes);
        if (
          expired && !options?.ignoreRetention &&
          instance._staleRetention === "evict"
        ) {
          continue;
        }
        yield [
          instance._plainToRequest(plainReqRes),
          instance._plainToResponse(plainReqRes, { stale: expired }),
        ] as const;
      }
    })();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this._storage?.dispose?.();
  }

  protected async _dbScan(prefix: string): Promise<string[]> {
    const allKeys = await this._storage.getKeys(prefix);
    const found: string[] = [];
    for (const k of allKeys) {
      const parts = this._splitKey(k);
      if (parts.length === 3 && parts[2].endsWith("_")) {
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

  protected async _dbKeys(key: string[] | string): Promise<string[]> {
    const indexKey = this._indexKey(key);
    const raw = await this._storage.getItemRaw(indexKey);
    if (!raw) {
      return [];
    }
    const entries = this._parseIndex(raw);
    return [...entries].sort();
  }

  protected async _dbGet(
    key: string[] | string,
  ): Promise<PlainReqRes | null> {
    const persistenceKey = Array.isArray(key) ? this._joinKey(key) : key;
    const raw = await this._storage.getItemRaw(persistenceKey);
    if (!raw) {
      await this._dbDel(key);
      return null;
    }
    return this._parse(raw as Uint8Array) as PlainReqRes;
  }

  protected async _dbDel(
    key: string[] | string,
  ): Promise<boolean> {
    const persistenceKey = Array.isArray(key) ? this._joinKey(key) : key;
    const existing = await this._storage.getItemRaw(persistenceKey);
    if (existing) {
      await this._storage.removeItem(persistenceKey);
    }

    const indexKey = this._indexKey(key);
    const raw = await this._storage.getItemRaw(indexKey);
    if (!raw) {
      return !!existing;
    }

    const entries = this._parseIndex(raw);
    entries.delete(persistenceKey);

    if (entries.size > 0) {
      await this._storage.setItemRaw(
        indexKey,
        this._serializeIndex(entries),
      );
    } else {
      await Promise.all([
        // Delete the index
        this._storage.removeItem(indexKey),
        // Delete the entries "parent key" which may not exist depending on driver
        this._storage.removeItem(indexKey.slice(0, -1)),
      ]);
    }

    return !!existing;
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
    if (raw instanceof Set) {
      return raw;
    }
    if (raw instanceof Array) {
      return new Set(raw);
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

import type {
    CachePersistenceBaseOptions,
    CachePersistenceFactory,
    CachePersistenceLike,
} from '../core/types.ts';

export type { CachePersistenceBaseOptions };

/**
 * A no-op persistence implementation. Stores nothing; logs each call.
 *
 * Accepts `CachePersistenceBaseOptions` (including `staleRetention` and
 * `maxPersistenceTtlMs`) for configuration-surface uniformity, but ignores
 * them because nothing is stored — neither retention policy nor
 * storage-lifetime ceiling has any observable effect.
 */
export class CachePersistenceNoop implements CachePersistenceLike {
    constructor(_options?: CachePersistenceBaseOptions) {
        // Options are accepted for configuration-surface uniformity but ignored
        // because the noop stores nothing.
    }

    async keys(): Promise<string[]> {
        console.log({ method: 'keys' }, `\n${'-'.repeat(80)}`);
        return [];
    }

    async put(
        cacheName: string,
        request: Request,
        response: Response,
    ): Promise<boolean> {
        console.log(
            { method: 'put', cacheName, request, response },
            `\n${'-'.repeat(80)}`,
        );
        return false;
    }

    async delete(
        cacheName: string,
        request: Request,
        response?: Response,
    ): Promise<boolean> {
        console.log(
            { method: 'delete', cacheName, request, response },
            `\n${'-'.repeat(80)}`,
        );
        return true;
    }

    async *get(
        cacheName: string,
        request: Request,
    ): AsyncGenerator<readonly [Request, Response], void, unknown> {
        console.log(
            { method: 'get', cacheName, request },
            `\n${'-'.repeat(80)}`,
        );
    }

    [Symbol.asyncIterator](
        cacheName: string,
    ): AsyncGenerator<readonly [Request, Response], void, unknown> {
        console.log(
            { method: '[[Symbol.asyncIterator]]', cacheName },
            `\n${'-'.repeat(80)}`,
        );
        return (async function* () {})();
    }

    async [Symbol.asyncDispose](): Promise<void> {
        console.log(
            { method: '[[Symbol.asyncDispose]]' },
            `\n${'-'.repeat(80)}`,
        );
    }
}

/**
 * Factory for the no-op persistence backend.
 *
 * Returns a {@link CachePersistenceFactory} suitable for
 * {@link createCacheStorage} or `new CacheStorage(...)`.
 */
export function noop(
    options?: CachePersistenceBaseOptions,
): CachePersistenceFactory {
    return { create: async () => new CachePersistenceNoop(options) };
}

export default noop;

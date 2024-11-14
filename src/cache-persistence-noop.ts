import type { CachePersistenceLike } from './types.ts';

export class CachePersistenceNoop implements CachePersistenceLike {
    async put(
        cacheName: string,
        request: Request,
        response: Response,
    ): Promise<boolean> {
        console.log(
            { method: 'put', cacheName, request, response },
            `\n${'-'.repeat(80)}`,
        );
        return true;
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

    async [Symbol.asyncDispose](cacheName: string): Promise<void> {
        console.log(
            { method: '[[Symbol.asyncDispose]]', cacheName },
            `\n${'-'.repeat(80)}`,
        );
    }
}

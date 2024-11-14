import { CachePersistenceRedis } from './cache-persistence-redis.ts';
import { CacheStorage } from './cache-storage.ts';
import { nextPort, startRedis, stopRedis } from './test-utils.ts';

const port = nextPort();
const server = await startRedis({ port });
//const port = 6379;

Object.defineProperty(globalThis, 'caches', {
    value: new CacheStorage({
        create: async () =>
            new CachePersistenceRedis({ port, hostname: '127.0.0.1' }),
    }, (name, value) => (name === 'user-agent' ? 'firefox' : value)),
});

await import('./cache-storage.base-test.ts');

// stopRedis(server);

import { CachePersistenceDenoKv } from './cache-persistence-denokv.ts';
import { CacheStorage } from './cache-storage.ts';

Object.defineProperty(globalThis, 'caches', {
    value: new CacheStorage({
        create: async () =>
            new CachePersistenceDenoKv({
                max: 1,
                min: 1,
            }),
    }, (name, value) => (name === 'user-agent' ? 'firefox' : value)),
});

await import('./cache-storage.base-test.ts');

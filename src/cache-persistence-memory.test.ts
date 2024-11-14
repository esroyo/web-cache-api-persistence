import { CachePersistenceMemory } from './cache-persistence-memory.ts';
import { CacheStorage } from './cache-storage.ts';

Object.defineProperty(globalThis, 'caches', {
    value: new CacheStorage(
        CachePersistenceMemory,
        (name, value) => (name === 'user-agent' ? 'firefox' : value),
    ),
});

await import('./cache-storage.base-test.ts');

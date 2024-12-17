# Web Cache API persistence
[![JSR](https://jsr.io/badges/@esroyo/web-cache-api-persistence)](https://jsr.io/@esroyo/web-cache-api-persistence) [![JSR Score](https://jsr.io/badges/@esroyo/web-cache-api-persistence/score)](https://jsr.io/@esroyo/web-cache-api-persistence) [![codecov](https://codecov.io/gh/esroyo/web-cache-api-persistence/graph/badge.svg?token=P5KP81J8ER)](https://codecov.io/gh/esroyo/web-cache-api-persistence)

A web [Cache API](https://web.dev/articles/cache-api-quick-guide) (almost) standard implementation that allows to use a custom storage/persistence layer.

## Introduction

This package provides a `CacheStorage` (and `Cache`) implementation that mostly adheres to the standard Cache API defined by the [Service Worker specification](https://w3c.github.io/ServiceWorker/#cache-interface). We could say It is like a Ponyfill.

```ts
import { CacheStorage } from 'jsr:@esroyo/web-cache-api-persistence';

const caches = new CacheStorage();

// Usage is similar to the native `caches` property of the Window interface
const cache = await caches.open("my-cache");

Deno.serve(async (req) => {
  const cached = await cache.match(req);
  // ...
```

The main goal of the library is to allow to use your own persistence layer, while the application code continues depending on the standard Cache interfaces, and hopefully remains unaware of the real implementation used.

We can use our own persistence layer by implementing the [`CachePersistenceLike`](./src/types.ts) interface:

```ts
import { CacheStorage, type CachePersistenceLike } from 'jsr:@esroyo/web-cache-api-persistence';

class MyCachePersistence implements CachePersistenceLike {
  // ...
}

const caches = new CacheStorage(MyCachePersistence);

// Usage is similar to the native `caches` property of the Window interface
const cache = await caches.open("my-cache");
```

## The persistence interface

The `CachePersistenceLike` interface specifies the core primitives for the storage. It _resembles_ parts of the [Cache](https://web.dev/articles/cache-api-quick-guide) and [CacheStorage](https://developer.mozilla.org/en-US/docs/Web/API/CacheStorage) interfaces, but note It mixes concerns of both and has important differences:

```ts
/**
 * Provides a persistence mechanism to be used by the Cache object.
 */
export interface CachePersistenceLike {
    /**
     * The keys() method of the CachePersistence interface fulfills a similar role
     * to the keys() method of the CacheStorage object. The persistence layer has
     * to return the cache names for which it currently stores Request/Response pairs.
     *
     * [MDN Reference](https://developer.mozilla.org/docs/Web/API/CacheStorage/keys)
     */
    keys(): Promise<string[]>;

    /**
     * The put() method of the CachePersistence interface is used by the
     * Cache object to store Request/Response pairs.
     *
     * The method responsability is limited to store the pair for latter usage.
     * Therefore, It should not perform checks on the given Request/Response objects.
     *
     * The specific implementations should decide the best way to perform
     * the storage operation, taking into account that for a given request
     * more than one response can exist.
     */
    put(
        cacheName: string,
        request: Request,
        response: Response,
    ): Promise<boolean>;

    /**
     * The delete() method of the CachePersistence interface is used by the
     * Cache object to delete an existing Request/Response pair, or all the
     * pairs associated the the same Request key.
     */
    delete(
        cacheName: string,
        request: Request,
        response?: Response,
    ): Promise<boolean>;

    /**
     * The get() method of the CachePersistence interface finds the entry whose key
     * is the request, and returns an async iterator that yields all the
     * Request/Response pairs associated to the key, one at a time.
     */
    get(
        cacheName: string,
        request: Request,
    ): AsyncGenerator<readonly [Request, Response], void, unknown>;

    /**
     * The [[Symbol.asyncIterator]] method of the CachePersistence interface returns
     * an async iterator that yields all the existing Request/Response pairs.
     * The pairs are returned in the order that they were inserted, that is older
     * pairs are yielded first.
     */
    [Symbol.asyncIterator](cacheName: string): AsyncGenerator<
        readonly [Request, Response],
        void,
        unknown
    >;

    /**
     * The [[Symbol.asyncDispose]] optional method of the CachePersistence interface
     * may be used to dispose internal resources used by the specific implementations.
     *
     * It will be called automatically if you open a Cache object with the `using` keyword.
     */
    [Symbol.asyncDispose]?(): Promise<void>;
}
```

## Headers normalization

It is possible to provide a function to normalize headers by implementing the interface [`CacheHeaderNormalizer`](./src/types.ts#L229).
Headers normalization is key to overcome [`Vary`](https://datatracker.ietf.org/doc/html/rfc7231#section-7.1.4) response headers that target request headers with great variation in the values (like `User-Agent`).
Even when the you may think that the request headers may not vary so much, It is convenient to implement headers normalization to minimize the amount of Responses stored. Checkout [this Fastly post](https://www.fastly.com/blog/best-practices-using-vary-header) for an extended explanation.

Imagine we have a Response that has the header `Vary: User-Agent`. Without headers normalization, for the same Request key we could potentially store hunders of different responses.
To avoid this potential pitfall, we can normalize the header to just two values, either `mobile` or `desktop`:
```ts
import { CacheStorage, type CachePersistenceLike } from 'jsr:@esroyo/web-cache-api-persistence';

class MyCachePersistence implements CachePersistenceLike {
  // ...
}

const headersNormalizer = (headerName: string, headerValue: string | null): string | null => {
  if (headerName === 'user-agent') {
    if (headerValue.match(/Mobile|Android|iPhone|iPad/)) {
      return "mobile";
    } else {
      return "desktop";
    }
  }
  return headerValue;
};

const caches = new CacheStorage(
  MyCachePersistence,
  headersNormalizer, // pass the normalization function as second param
);
const cache = await caches.open("my-cache");

Deno.serve(async (req) => {
  // given a Request with "User-Agent: Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.135 Mobile Safari/537.36"
  // or a Request with "User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_7_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1"
  // both would match...
  const cached = await cache.match(req);
  // ...
```

## Additional modules

This package includes some `CachePersistence` implementations:
* [Memory](./src/cache-persistence-memory.ts) (default): It stores the Request/Response pairs in a plain object, therefore It doesn't really provide persistence beyond the current process duration. It can be used for testing the library without further complications.
* [Deno KV](./src/cache-persistence-deno-kv.ts): Implemente using [kv-toolbox](https://jsr.io/@kitsonk/kv-toolbox) to provide arbitrarily large Response sizes.
* [Redis](./src/cache-persistence-redis.ts): Implemented with the [Deno native client](https://github.com/denodrivers/redis).

## Key differences with the specification

### Cache lifetimes
The spec [states](https://w3c.github.io/ServiceWorker/#cache-lifetimes) that _"The Cache objects do not expire unless authors delete the entries."_

In contrast, the provided `CachePersistence` implementations do honor the Response _expiration_ headers, much like [proposed by Deno](https://deno.com/blog/deploy-cache-api#cache-policy). The Responses expire according to the `Cache-Control` or `Expires` headers when using some of the provided persistence implementations. However note this logic resides in the specific `CachePersistence` implementations, not in `Cache`/`CacheStorage` themselves, thus you can implement your own persistence and get rid of that behaviour.

### Exceptions handling

The spec [states](https://w3c.github.io/ServiceWorker/#batch-cache-operations) that a if an Exception was thrown during a _Batched Cache Operation_, then all items from the relevant request response list should be reverted to the orignal cached values. This is **not** implemented.

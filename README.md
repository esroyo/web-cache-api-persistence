# Web Cache API persistence

[![JSR](https://jsr.io/badges/@esroyo/web-cache-api-persistence)](https://jsr.io/@esroyo/web-cache-api-persistence)
[![JSR Score](https://jsr.io/badges/@esroyo/web-cache-api-persistence/score)](https://jsr.io/@esroyo/web-cache-api-persistence)
[![codecov](https://codecov.io/gh/esroyo/web-cache-api-persistence/graph/badge.svg?token=P5KP81J8ER)](https://codecov.io/gh/esroyo/web-cache-api-persistence)

A web [Cache API](https://web.dev/articles/cache-api-quick-guide) (almost)
standard implementation that allows to use a custom storage/persistence layer.

## Introduction

This package provides a `CacheStorage` (and `Cache`) implementation that mostly
adheres to the standard Cache API defined by the
[Service Worker specification](https://w3c.github.io/ServiceWorker/#cache-interface).
We could say It is like a Ponyfill.

```ts
import { createCacheStorage } from 'jsr:@esroyo/web-cache-api-persistence';
import memory from 'jsr:@esroyo/web-cache-api-persistence/memory';

const caches = createCacheStorage({ persistence: memory() });

// Usage is similar to the native `caches` property of the Window interface
const cache = await caches.open('my-cache');

Deno.serve(async (req) => {
  const cached = await cache.match(req);
  // ...
```

Each bundled backend lives under its own sub-path module which exports a default
factory function (the common case), the persistence class (for advanced use such
as subclassing or `instanceof` checks), and the options type. Backends are
imported only via their sub-path so that consumers pay no dependency-resolution
cost for backends they don't use.

The main goal of the library is to allow to use your own persistence layer,
while the application code continues depending on the standard Cache interfaces,
and hopefully remains unaware of the real implementation used.

### Backends

The package ships five backends, each addressable through a flat sub-path:

- `jsr:@esroyo/web-cache-api-persistence/memory` — in-process map; no real
  persistence, good for tests and ephemeral caches.
- `jsr:@esroyo/web-cache-api-persistence/noop` — discards everything; useful for
  benchmarking or disabling caching behind a flag.
- `jsr:@esroyo/web-cache-api-persistence/deno-kv` — persists through
  [Deno KV](https://docs.deno.com/deploy/kv/manual/) via
  [`kv-toolbox`](https://jsr.io/@kitsonk/kv-toolbox); supports arbitrarily large
  responses.
- `jsr:@esroyo/web-cache-api-persistence/deno-redis` — persists through the
  [Deno-native Redis client](https://github.com/denodrivers/redis).
- `jsr:@esroyo/web-cache-api-persistence/unstorage` — adapter for
  [unstorage](https://github.com/unjs/unstorage), a universal storage layer with
  20+ drivers (filesystem, S3, Cloudflare KV, Upstash Redis, Deno KV, etc.).
  Binary data is stored via `setItemRaw`/`getItemRaw` and **TTL is delegated to
  native driver** (check per-driver support).

Each sub-path exports the same shape: a default factory (e.g. `denoRedis`), a
same-identity named factory, the persistence class, and the options type. Pick
the abstraction level you want from one import path:

```ts
// Common case: default-imported factory + createCacheStorage.
import { createCacheStorage } from "jsr:@esroyo/web-cache-api-persistence";
import denoRedis from "jsr:@esroyo/web-cache-api-persistence/deno-redis";

const caches = createCacheStorage({
  persistence: denoRedis({ port: 6379 }),
});
```

```ts
// Advanced case: named class import (subclassing, instanceof, custom factory).
import {
  CachePersistenceDenoRedis,
  type CachePersistenceDenoRedisOptions,
} from "jsr:@esroyo/web-cache-api-persistence/deno-redis";
import { CacheStorage } from "jsr:@esroyo/web-cache-api-persistence";

const options: CachePersistenceDenoRedisOptions = { port: 6379 };

const caches = new CacheStorage({
  create: async () => new CachePersistenceDenoRedis(options),
});
```

### Custom persistence (low-level API)

We can use our own persistence layer by implementing the
[`CachePersistenceLike`](./src/core/types.ts) interface. For bundled backends
the recommended entry point is the per-backend sub-path described above — this
low-level form is for custom persistence classes:

```ts
import {
  type CachePersistenceLike,
  CacheStorage,
} from "jsr:@esroyo/web-cache-api-persistence";

class MyCachePersistence implements CachePersistenceLike {
  // ...
}

const caches = new CacheStorage(MyCachePersistence);

// Usage is similar to the native `caches` property of the Window interface
const cache = await caches.open("my-cache");
```

## The persistence interface

The `CachePersistenceLike` interface specifies the core primitives for the
storage. It _resembles_ parts of the
[Cache](https://web.dev/articles/cache-api-quick-guide) and
[CacheStorage](https://developer.mozilla.org/en-US/docs/Web/API/CacheStorage)
interfaces, but note It mixes concerns of both and has important differences:

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
   *
   * The optional `options.ignoreRetention` flag bypasses stale-entry filtering,
   * causing expired entries to be yielded even under `"retain"` mode.
   */
  get(
    cacheName: string,
    request: Request,
    options?: CachePersistenceQueryOptions,
  ): AsyncGenerator<readonly [Request, Response], void, unknown>;

  /**
   * The [[Symbol.asyncIterator]] method of the CachePersistence interface returns
   * an async iterator that yields all the existing Request/Response pairs.
   * The pairs are returned in the order that they were inserted, that is older
   * pairs are yielded first.
   *
   * The optional `options.ignoreRetention` flag bypasses stale-entry filtering,
   * causing expired entries to be yielded even under `"retain"` mode.
   */
  [Symbol.asyncIterator](
    cacheName: string,
    options?: CachePersistenceQueryOptions,
  ): AsyncGenerator<
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

It is possible to provide a function to normalize headers by implementing the
interface [`CacheHeaderNormalizer`](./src/core/types.ts). Headers normalization
is key to overcome
[`Vary`](https://datatracker.ietf.org/doc/html/rfc7231#section-7.1.4) response
headers that target request headers with great variation in the values (like
`User-Agent`). Even when the you may think that the request headers may not vary
so much, It is convenient to implement headers normalization to minimize the
amount of Responses stored. Checkout
[this Fastly post](https://www.fastly.com/blog/best-practices-using-vary-header)
for an extended explanation.

Imagine we have a Response that has the header `Vary: User-Agent`. Without
headers normalization, for the same Request key we could potentially store
hunders of different responses. To avoid this potential pitfall, we can
normalize the header to just two values, either `mobile` or `desktop`:

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

## Stale entries and revalidation

Construct a persistence with `staleRetention: 'retain'` to make `cache.match()`
return stale entries (alongside fresh ones), with an `x-cachestorage-stale: 1`
header on the materialised `Response`. No non-standard `Cache` method is
involved — plain W3C `Cache.match()` plus a single header check:

```ts
import { createCacheStorage } from "@esroyo/web-cache-api-persistence";
import memory from "@esroyo/web-cache-api-persistence/memory";

const caches = createCacheStorage({
  persistence: memory({ staleRetention: "retain" }),
});

const cache = await caches.open("v1");
const req = new Request("https://example.com/api");

const response = await cache.match(req);
if (response && response.headers.get("x-cachestorage-stale") === "1") {
  // Entry is past its HTTP expiration. Revalidate with the origin using
  // `ETag` / `Last-Modified` for cheap `304 Not Modified` reuse.
  const revalidated = await fetch(req.url, {
    headers: {
      "if-none-match": response.headers.get("etag") ?? "",
      "if-modified-since": response.headers.get("last-modified") ?? "",
    },
  });
  // A real 304 handler would merge the freshness headers from the 304
  // (`Cache-Control`, `Date`, `Expires`, `ETag`, …) onto the cached body
  // and re-store the merged response (RFC 9111 §4.3.4). That's beyond
  // this snippet; we just replace the entry with the revalidated payload.
  // `cache.put` overwrites the stale predecessor for the same request.
  await cache.put(req, revalidated.clone());
} else if (response) {
  // Fresh; use as-is.
}
```

For a **pure-TTL cache** that ignores HTTP semantics entirely, combine
`'retain'` with a small custom `maxPersistenceTtlMs` and ignore the marker:

```ts
const caches = createCacheStorage({
  persistence: memory({
    staleRetention: "retain",
    maxPersistenceTtlMs: 60_000, // 60-second TTL
  }),
});

const cache = await caches.open("session");
// Entries live exactly 60 seconds regardless of any `Cache-Control` on the
// stored Responses. The application can ignore `x-cachestorage-stale`.
const cached = await cache.match(req);
if (cached) {
  // It's been put within the last 60 seconds.
}
```

## Cache query utilities

The package exports pure utility functions for HTTP freshness and W3C Cache
query matching, importable from the package root:

```ts
import {
  freshnessLifetimeMs,
  isFreshResponse,
  isStaleResponse,
  requestMatches,
} from "jsr:@esroyo/web-cache-api-persistence";
```

All four functions are pure computations over standard `Request`/`Response`
objects.

#### **`freshnessLifetimeMs(response, now?)`**

Returns milliseconds until the response is stale per RFC 9111 §4.2.1 (`0` if no
explicit freshness):

```ts
freshnessLifetimeMs(
  new Response(null, {
    headers: {
      "cache-control": "max-age=3600",
      date: new Date().toUTCString(),
    },
  }),
); // ~3_600_000
```

#### **`isFreshResponse(response, now?)`**

`true` when `freshnessLifetimeMs > 0`:

```ts
isFreshResponse(resp); // boolean
```

#### **`isStaleResponse(response, now?)`**

Logical complement of `isFreshResponse`:

```ts
isStaleResponse(resp); // !isFreshResponse(resp)
```

#### **`requestMatches(query, cached, response?, options?, normalizer?)`**

W3C Cache query matching (URL, method, Vary, `ignore*` options):

```ts
requestMatches(queryReq, cachedReq, cachedResp, { ignoreSearch: true });
// true when URLs match ignoring search params
```

## Key differences with the specification

### Cache lifetimes

The spec [states](https://w3c.github.io/ServiceWorker/#cache-lifetimes) that
_"The Cache objects do not expire unless authors delete the entries."_

The bundled `CachePersistence` implementations deviate from that, much like
[proposed by Deno](https://deno.com/blog/deploy-cache-api#cache-policy): by
default entries are evicted when their HTTP expiration (`Cache-Control: max-age`
/ `s-maxage`, or `Expires`) is reached. That default is pragmatic for HTTP
caching but is the library's deviation from W3C.

Since v0.4.0, two construction-time options on the bundled implementations let
you pick where on the spec-versus-pragmatism axis you want to be, with an
explicit storage-lifetime ceiling on top:

| Option                | Controls                                                                                                                                                                           | Default                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `staleRetention`      | What happens to an entry that passes HTTP expiration but is still within `maxPersistenceTtlMs` — evict it (`'evict'`) or retain it as observable-but-stale (`'retain'`).           | `'evict'`                 |
| `maxPersistenceTtlMs` | Universal upper bound on entry storage lifetime, in milliseconds. Applied in **every** `staleRetention` mode. Distinct from HTTP `Expires:` / `Cache-Control` freshness semantics. | `2_592_000_000` (30 days) |

#### The four canonical configurations

| `staleRetention`    | `maxPersistenceTtlMs`                                                | Behavior                                                                                                                                                                            | When to use                                                                                     |
| ------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `'evict'` (default) | `2_592_000_000` (default)                                            | HTTP-cache pragmatism. Entries evicted at `min(httpExpiresIn, 30d)`. Library's historical behavior.                                                                                 | General HTTP caching where revalidation is not needed.                                          |
| `'retain'`          | `2_592_000_000` (default)                                            | HTTP-cache with revalidation support. Entries become stale at HTTP expiration but stay retrievable up to 30 days; `x-cachestorage-stale` signals freshness.                         | Caches that want `ETag` / `Last-Modified` revalidation, stale-while-revalidate, stale-if-error. |
| `'retain'`          | Custom (e.g. `60_000`)                                               | Pure absolute-TTL cache, ignores HTTP semantics. Entries live exactly `maxPersistenceTtlMs` ms regardless of `Cache-Control`. Application typically ignores `x-cachestorage-stale`. | Session caches, computed-value caches, anywhere upstream `Cache-Control` is irrelevant.         |
| `'retain'`          | Very large (e.g. `Number.MAX_SAFE_INTEGER`, subject to backend caps) | Maximally spec-pure W3C `Cache`. Entries persist effectively until `Cache.delete()`.                                                                                                | Service-Worker-style caches; tests; deliberately spec-conforming setups.                        |

In both modes the eviction primitive (Memory `setTimeout`, Deno KV `setBlob`'s
`expireIn`, Redis `PEXPIRE`) is always invoked — what changes between modes is
the delay value passed to it.

The persistence-layer `get()` and async iterator behave accordingly: under
`'evict'` they skip entries whose `expires` is in the past (an extra guard
against the eviction-timing race); under `'retain'` they yield expired entries
with `x-cachestorage-stale: 1` set on the materialised `Response`.

#### RFC 9111 alignment for header-less responses

Prior to v0.4.0, the library silently cached responses with neither
`Cache-Control` nor `Expires` for 30 days. That was an undocumented
heuristic-freshness policy in disguise and **violated RFC 9111 §4.2.1**, which
says such responses have no explicit freshness lifetime.

The library now treats header-less responses correctly:

- Under default `staleRetention: 'evict'`: header-less responses have
  `_expiresIn` = 0 and are not stored at all (no freshness signal justifies
  caching them).
- Under `staleRetention: 'retain'`: header-less responses are stored, are
  immediately stale on first read (`x-cachestorage-stale: 1` set), and are
  retained for `maxPersistenceTtlMs`.

**Migration:** if you previously relied on the 30-day fallback for header-less
responses, either (a) set explicit `Cache-Control: max-age=N` on the response
before `put`-ing, where `N` is the intended freshness lifetime in seconds, or
(b) switch to `staleRetention: 'retain'` and read the `x-cachestorage-stale`
header to decide what to do.

#### Backend constraint: Deno KV native `expireIn` cap

Deno KV silently clamps `expireIn` values exceeding 2,592,000,000 ms (its own
30-day cap on `Deno.KvSetOptions['expireIn']`). `maxPersistenceTtlMs` is
therefore the **requested** upper bound, subject to backend constraints — a
configuration of `maxPersistenceTtlMs: 60 * 24 * 60 * 60_000` (60 days) on Deno
KV will see entries evicted at 30 days.

#### Pairing `'retain'` with backend eviction backstops

For production deployments using `'retain'` with a long `maxPersistenceTtlMs`
and no application-level cleanup, pair with backend eviction policies:

- Redis: configure `maxmemory-policy: allkeys-lru` (or similar).
- Deno KV: its native 30-day cap is the backstop.
- Memory: pair with an application-level cleanup job, or accept that the process
  holds entries for up to `maxPersistenceTtlMs`.

### Exceptions handling

The spec [states](https://w3c.github.io/ServiceWorker/#batch-cache-operations)
that a if an Exception was thrown during a _Batched Cache Operation_, then all
items from the relevant request response list should be reverted to the orignal
cached values. This is **not** implemented.

## Migration from versions prior to v0.4

Versions prior to v0.4 re-exported backend persistence classes from the package
root and used the shorter `CachePersistenceRedis` naming. The following breaking
changes were introduced in v0.4:

- **`mod.ts` no longer re-exports backend persistence classes.** Imports of
  `CachePersistenceMemory`, `CachePersistenceDenoKv`, `CachePersistenceNoop`,
  and `CachePersistenceRedis` from the package root will fail to resolve and
  must move to the matching sub-path.
- **`CachePersistenceRedis` is renamed to `CachePersistenceDenoRedis`** (and
  `CachePersistenceRedisOptions` → `CachePersistenceDenoRedisOptions`). The old
  names remain available as `@deprecated` aliases re-exported from
  `/deno-redis`, and refer to the same class identity (so `instanceof` against
  either name keeps working). Removal is targeted for the next major release.

Mechanical migration table:

| Old import                                                                                 | New import                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `import { CachePersistenceMemory } from 'jsr:.../web-cache-api-persistence'`               | `import { CachePersistenceMemory } from 'jsr:.../web-cache-api-persistence/memory'`                                                                                                                                   |
| `import { CachePersistenceDenoKv } from 'jsr:.../web-cache-api-persistence'`               | `import { CachePersistenceDenoKv } from 'jsr:.../web-cache-api-persistence/deno-kv`                                                                                                                                   |
| `import { CachePersistenceNoop } from 'jsr:.../web-cache-api-persistence'` (if applicable) | `import { CachePersistenceNoop } from 'jsr:.../web-cache-api-persistence/noop'`                                                                                                                                       |
| `import { CachePersistenceRedis } from 'jsr:.../web-cache-api-persistence'`                | `import { CachePersistenceRedis } from 'jsr:.../web-cache-api-persistence/deno-redis'` (deprecated alias) OR `import { CachePersistenceDenoRedis } from 'jsr:.../web-cache-api-persistence/deno-redis'` (recommended) |

Switching to the `createCacheStorage` + factory idiom is recommended but not
required — `new CacheStorage(...)` continues to work unchanged.

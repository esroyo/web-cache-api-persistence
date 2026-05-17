# unstorage-backend Specification

## ADDED Requirements

### Requirement: The unstorage sub-path module SHALL export a class, a factory, an options type, and a default factory

The module at `src/unstorage/mod.ts` SHALL export:

- a class named `CachePersistenceUnstorage` as a named export
- a function named `unstorage` as a named export (the factory)
- a type named `CachePersistenceUnstorageOptions` as a named type export
- the same `unstorage` function as the default export

The factory SHALL be callable with an options object and SHALL return a
`CachePersistenceFactory` whose `create()` produces a
`CachePersistenceUnstorage` instance. The default and named exports of the
factory SHALL be referentially identical.

#### Scenario: default and named exports are identity-equal

- **WHEN** `import unstorageDefault from '../unstorage/mod.ts'` and
  `import { unstorage } from '../unstorage/mod.ts'` are both resolved (path
  resolution from within `src/`)
- **THEN** `unstorageDefault === unstorage` evaluates to `true`

#### Scenario: factory.create() returns a CachePersistenceUnstorage instance

- **WHEN** `unstorage({ storage: createStorage() }).create()` is awaited
- **THEN** the returned object is `instanceof CachePersistenceUnstorage`

#### Scenario: factory does not memoize across create() calls

- **WHEN** `factory.create()` is called twice sequentially with the same
  arguments
- **THEN** the two returned instances are not the same object (`a !== b`)

#### Scenario: factory does not share state across distinct factory-function calls

- **WHEN** `const fA = unstorage(opts)` and `const fB = unstorage(opts)` are
  called
- **THEN** `fA !== fB`

#### Scenario: factory does not mutate the options argument

- **WHEN** `unstorage(opts).create()` is called and the original `opts` object
  is inspected before and after
- **THEN** all fields of `opts` retain their original values

### Requirement: CachePersistenceUnstorage SHALL accept a pre-configured unstorage Storage instance

The `CachePersistenceUnstorageOptions` interface SHALL extend
`CachePersistenceBaseOptions` and SHALL include a required `storage` field of
type `Storage` (from the `unstorage` package).

#### Scenario: constructed with storage option does not throw

- **WHEN** `new CachePersistenceUnstorage({ storage: createStorage() })` is
  constructed
- **THEN** construction succeeds without throwing

#### Scenario: missing storage throws

- **WHEN** the storage option is omitted or undefined
- **THEN** a `TypeError` is thrown at construction or on first operation

### Requirement: CachePersistenceUnstorage SHALL persist and retrieve Request/Response pairs through the given unstorage Storage

`put` followed by `match`/`matchAll` SHALL return the stored response body,
headers, status, and status text for the matching request, following standard
Cache API semantics. Multiple `put` calls for the same request URL SHALL replace
the previous entry (only one entry is observable via `match`).

This requirement SHALL be tested through the W3C-style `Cache` interface
(`caches.open`, `cache.put`, `cache.match`, `cache.matchAll`, `cache.delete`) —
never through unstorage's own `getItem`/`getKeys` — to guarantee the backend
integrates correctly with `Cache` and `CacheStorage`.

#### Scenario: put then match returns the stored response

- **WHEN** a `Cache` constructed over a
  `CachePersistenceUnstorage({ storage: createStorage() })` receives `PUT` for
  `Request('http://example.com/a')` with a
  `Response('hello', { status: 200, headers: { 'content-type': 'text/plain' } })`
  bearing `Cache-Control: max-age=3600`, and
  `MATCH(Request('http://example.com/a'))` is then called
- **THEN** the matched `Response` is defined (not `undefined`),
  `await matched.text()` equals `'hello'`, `matched.status` equals `200`, and
  `matched.headers.get('content-type')` equals `'text/plain'`

#### Scenario: put followed by a second put for the same request replaces the entry

- **WHEN**
  `cache.put(req, new Response('A', { headers: { 'cache-control': 'max-age=3600' } }))`
  is followed by
  `cache.put(req, new Response('B', { headers: { 'cache-control': 'max-age=3600' } }))`,
  and `cache.matchAll(req)` is collected
- **THEN** the resulting array has length `1` and `await result[0].text()`
  equals `'B'`

#### Scenario: delete removes a stored entry

- **WHEN** a response is stored via `put`, then `cache.delete(req)` is called,
  then `cache.match(req)` is called
- **THEN** `cache.match(req)` returns `undefined`

#### Scenario: delete for a non-existent key returns false

- **WHEN** `cache.delete(new Request('http://example.com/never-put'))` is called
- **THEN** the returned boolean is `false`

#### Scenario: entries from different caches are isolated

- **WHEN** `cacheA.put(req, responseA)` and `cacheB.put(req, responseB)` are
  performed on two different named caches backed by the same
  `CachePersistenceUnstorage` instance, then `cacheA.match(req)` and
  `cacheB.match(req)` are called
- **THEN** `await cacheA.match(req).text()` equals responseA's body and
  `await cacheB.match(req).text()` equals responseB's body

#### Scenario: entries from different cache storages are isolated

- **WHEN** two distinct `CacheStorage` instances each create their own cache
  using the same unstorage `Storage` instance (different persistence instances
  sharing the same unstorage backend), and each stores and retrieves entries
- **THEN** entries from one `CacheStorage` do not interfere with entries from
  the other

### Requirement: CachePersistenceUnstorage SHALL support staleRetention modes

The backend SHALL inherit `staleRetention` and `maxPersistenceTtlMs` from
`CachePersistenceBaseOptions`. Under `'evict'` (default), entries past HTTP
expiration SHALL NOT be yielded by `get()` or the async iterator. Under
`'retain'`, past-expiration entries SHALL be yielded with
`x-cachestorage-stale: 1` on the materialised Response.

#### Scenario: evict mode (default) does not return expired entries

- **WHEN** a `CachePersistenceUnstorage` constructed with default options
  receives `put` for a request with `Cache-Control: max-age=1` and body
  `'fresh'`, real time advances by 2000 ms, and `cache.match(req)` is called
- **THEN** `cache.match(req)` returns `undefined`

#### Scenario: retain mode returns expired entries with stale marker

- **WHEN** a `CacheStorage` is created with
  `CachePersistenceUnstorage({ storage: createStorage(), staleRetention: 'retain', maxPersistenceTtlMs: 60_000 })`,
  a response with `Cache-Control: max-age=1` and body `'stale-but-present'` is
  put, real time advances by 2000 ms, and `cache.match(req)` is called
- **THEN** the matched Response is defined, `await matched.text()` equals
  `'stale-but-present'`, and `matched.headers.get('x-cachestorage-stale')`
  equals `'1'`

#### Scenario: retain mode with header-less response is stored and immediately stale

- **WHEN** a `CachePersistenceUnstorage` constructed with
  `{ storage: createStorage(), staleRetention: 'retain' }` receives `put` for a
  `new Response('no-cache-headers')`, and `cache.match(req)` is called
  immediately
- **THEN** the matched Response is defined and
  `matched.headers.get('x-cachestorage-stale')` equals `'1'`

### Requirement: CachePersistenceUnstorage SHALL encrypt or encode response bodies with large content

The backend SHALL handle response bodies of arbitrary size by storing them
through `_serialize`/`_parse` (which produces `Uint8Array`). unstorage's
`setItemRaw`/`getItemRaw` SHALL be used for storage, falling back to base64
encoding for drivers without native raw support.

#### Scenario: large response body is stored and retrieved correctly

- **WHEN** a response with a body of 100 KB (or any size larger than a typical
  single-packet payload) is stored via `put`, retrieved via `cache.match()`, and
  the body is fully consumed
- **THEN** the consumed body is byte-for-byte identical to the original

### Requirement: CachePersistenceUnstorage errors SHALL propagate

When an unstorage operation throws, the error SHALL propagate through the Cache
API surface unswallowed.

#### Scenario: storage failure on put propagates

- **WHEN** an unstorage `Storage` is configured with a driver whose `setItemRaw`
  (or `setItem`) throws, and a `put` is attempted
- **THEN** the `put` call throws (rejects) with the original error

### Requirement: CachePersistenceUnstorage SHALL work with the built-in unstorage memory driver

The simplest backend — unstorage's default in-process memory driver
(`createStorage()` with no arguments) — SHALL function as a correct persistence
layer for all standard Cache operations. This is the primary test vehicle.

#### Scenario: full Cache CRUD cycle works with unstorage memory driver

- **WHEN**
  `caches = new CacheStorage({ create: async () => new CachePersistenceUnstorage({ storage: createStorage() }) })`
  is used, a cache is opened, a request/response pair is put, matched,
  matchAll'd, and deleted through the standard Cache API
- **THEN** all operations complete without error and return the expected results

### Requirement: The unstorage backend SHALL be registered in deno.json as a sub-path export

The `exports` map in `deno.json` SHALL include
`"./unstorage": "./src/unstorage/mod.ts"`, following the same pattern as the
existing per-backend sub-paths (`./memory`, `./deno-kv`, `./deno-redis`,
`./noop`).

#### Scenario: sub-path resolves to the module

- **WHEN**
  `import { unstorage } from '@esroyo/web-cache-api-persistence/unstorage'` is
  resolved
- **THEN** the resolved module is `./src/unstorage/mod.ts`

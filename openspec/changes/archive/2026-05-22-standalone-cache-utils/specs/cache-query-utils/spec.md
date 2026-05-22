## ADDED Requirements

### Requirement: `freshnessLifetimeMs()` computes RFC 9111 §4.2.1 remaining freshness

The function SHALL accept a `Response` and an optional `now` epoch-millis
parameter.

`now` SHALL default to `Date.now()` when omitted.

The function SHALL return the number of milliseconds until the response is
considered stale according to HTTP freshness semantics (RFC 9111 §4.2.1).

The function SHALL return `0` for responses that have no explicit freshness
lifetime (no `Cache-Control: max-age`, no `Cache-Control: s-maxage`, no
`Expires` header).

#### Scenario: `Cache-Control: max-age` with explicit `Date`

- **WHEN** `freshnessLifetimeMs` is called with a Response that has headers
  `Cache-Control: public, max-age=3600` and
  `Date: Tue, 15 Nov 2024 12:00:00 GMT` and `now` is set to
  `Tue, 15 Nov 2024 12:00:00 GMT` (the same instant as Date)
- **THEN** it SHALL return `3_600_000` (3600 seconds in ms)

#### Scenario: `Cache-Control: s-maxage` takes priority over `max-age`

- **WHEN** `freshnessLifetimeMs` is called with a Response that has headers
  `Cache-Control: public, s-maxage=60, max-age=3600` and `Date` matching `now`
- **THEN** it SHALL return `60_000` (s-maxage wins)

#### Scenario: `Expires` header when no `Cache-Control` max-age

- **WHEN** `freshnessLifetimeMs` is called with a Response that has only
  `Expires: Tue, 15 Nov 2024 13:00:00 GMT` and `now` is set to
  `Tue, 15 Nov 2024 12:00:00 GMT`
- **THEN** it SHALL return `3_600_000`

#### Scenario: Absence of `Date` header falls back to `now`

- **WHEN** `freshnessLifetimeMs` is called with a Response that has
  `Cache-Control: max-age=60` but no `Date` header and `now` is set to
  `1_000_000_000_000`
- **THEN** it SHALL return `60_000` (age computed from `now` as fallback for
  `Date`)

#### Scenario: Upstream `Age` reduces freshness

- **WHEN** `freshnessLifetimeMs` is called with a Response that has headers
  `Cache-Control: public, max-age=60`, `Age: 30`, and `Date` matching `now`
- **THEN** it SHALL return `30_000` (60 - 30 seconds)

#### Scenario: Already-expired response returns 0

- **WHEN** `freshnessLifetimeMs` is called with a Response that has
  `Cache-Control: max-age=60` and `Date: 1 hour ago` and `now` is `1 hour + 1ms`
  after `Date`
- **THEN** it SHALL return `0`

#### Scenario: No freshness headers returns 0

- **WHEN** `freshnessLifetimeMs` is called with a Response that has no
  `Cache-Control` and no `Expires` headers
- **THEN** it SHALL return `0`

### Requirement: `isFreshResponse()` / `isStaleResponse()` provide boolean freshness check

`isFreshResponse(response, now?)` SHALL return `true` when
`freshnessLifetimeMs(response, now) > 0`, `false` otherwise.

`isStaleResponse(response, now?)` SHALL return `true` when
`freshnessLifetimeMs(response, now) <= 0`, `false` otherwise.

The two functions SHALL be logical complements:
`isFreshResponse(r, n) === !isStaleResponse(r, n)` for any inputs.

#### Scenario: Fresh response

- **WHEN** `isFreshResponse` is called with a Response that has
  `Cache-Control: max-age=3600` and `now` set to the same instant as the `Date`
  header
- **THEN** it SHALL return `true`

#### Scenario: Stale response

- **WHEN** `isFreshResponse` is called with a Response that has
  `Cache-Control: max-age=0` and any `now`
- **THEN** it SHALL return `false`

#### Scenario: Complement relationship

- **WHEN** `isFreshResponse(r, n)` and `isStaleResponse(r, n)` are called with
  the same arguments
- **THEN** the results SHALL always be opposite booleans

### Requirement: `requestMatches()` implements W3C Cache query matching

The function SHALL accept a `query` Request, a `cached` Request, an optional
`cachedResponse` Response, an optional `options` object, and an optional
`normalizer` function.

The `normalizer` SHALL default to an identity function `(name, value) => value`
when omitted.

`options` may contain `ignoreMethod`, `ignoreSearch`, `ignoreVary` booleans,
matching the semantics of `CacheQueryOptions`.

The function SHALL return `true` when the query matches the cached entry per W3C
Cache matching algorithm, `false` otherwise.

#### Scenario: URL equality without hash

- **WHEN** `requestMatches` is called with `query` = `http://example.com/foo`
  and `cached` = `http://example.com/foo`
- **THEN** it SHALL return `true`

#### Scenario: Hash fragment is disregarded

- **WHEN** `requestMatches` is called with `query` =
  `http://example.com/foo#section` and `cached` = `http://example.com/foo`
- **THEN** it SHALL return `true`

#### Scenario: Mismatched search returns false

- **WHEN** `requestMatches` is called with `query` =
  `http://example.com/foo?bar=1` and `cached` = `http://example.com/foo` and no
  `ignoreSearch` option
- **THEN** it SHALL return `false`

#### Scenario: `ignoreSearch` bypasses search mismatch

- **WHEN** `requestMatches` is called with `query` =
  `http://example.com/foo?bar=1`, `cached` = `http://example.com/foo`, and
  `options = { ignoreSearch: true }`
- **THEN** it SHALL return `true`

#### Scenario: Non-GET method returns false by default

- **WHEN** `requestMatches` is called with `cached` having method `POST`
- **THEN** it SHALL return `false`

#### Scenario: `ignoreMethod` allows non-GET

- **WHEN** `requestMatches` is called with `cached` having method `POST` and
  `options = { ignoreMethod: true }`
- **THEN** it SHALL return `true`

#### Scenario: Vary header matching with normalizer

- **WHEN** `requestMatches` is called with `cachedResponse` having header
  `Vary: Accept-Encoding`, `cached` with header `Accept-Encoding: gzip`, `query`
  with header `Accept-Encoding: gzip`
- **THEN** it SHALL return `true`

#### Scenario: Vary mismatch returns false

- **WHEN** `requestMatches` is called with `cachedResponse` having header
  `Vary: Accept-Encoding`, `cached` with `Accept-Encoding: gzip`, `query` with
  `Accept-Encoding: deflate`
- **THEN** it SHALL return `false`

#### Scenario: Normalizer reconciles different values

- **WHEN** `requestMatches` is called with `cachedResponse` having header
  `Vary: Accept-Encoding`, `cached` with `Accept-Encoding: gzip`, `query` with
  `Accept-Encoding: gzip, br`, and a normalizer that maps both to `"gzip"`
- **THEN** it SHALL return `true`

#### Scenario: `ignoreVary` bypasses Vary comparison

- **WHEN** `requestMatches` is called with `cachedResponse` having header
  `Vary: Accept-Encoding`, mismatched values, and
  `options = { ignoreVary: true }`
- **THEN** it SHALL return `true`

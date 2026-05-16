## MODIFIED Requirements

### Requirement: Storage SHALL accept maxPersistenceTtlMs as a public option

`CachePersistenceBaseOptions` SHALL include an optional
`maxPersistenceTtlMs?: number` field, defaulting to `2_592_000_000` (30 days).
All four bundled persistence classes — `CachePersistenceMemory`,
`CachePersistenceDenoKv`, `CachePersistenceDenoRedis`, and
`CachePersistenceNoop` — SHALL inherit this option via their options-interface
extension chain. The provided value MUST be stored on the protected
`_maxPersistenceTtlMs` field of `CachePersistenceBase` so existing subclasses
that read `this._maxPersistenceTtlMs` continue to work.

#### Scenario: default value is 2_592_000_000

- **WHEN** `new CachePersistenceMemory()` is constructed with no options
- **THEN**
  `(instance as unknown as { _maxPersistenceTtlMs: number })._maxPersistenceTtlMs === 2_592_000_000`

#### Scenario: provided value flows to the protected field for Memory

- **WHEN** `new CachePersistenceMemory({ maxPersistenceTtlMs: 60_000 })` is
  constructed
- **THEN**
  `(instance as unknown as { _maxPersistenceTtlMs: number })._maxPersistenceTtlMs === 60_000`

#### Scenario: provided value flows to the protected field for Deno KV

- **WHEN**
  `new CachePersistenceDenoKv({ maxPersistenceTtlMs: 60_000, max: 1, min: 1 })`
  is constructed
- **THEN**
  `(instance as unknown as { _maxPersistenceTtlMs: number })._maxPersistenceTtlMs === 60_000`

#### Scenario: provided value flows to the protected field for Deno Redis

- **WHEN**
  `new CachePersistenceDenoRedis({ maxPersistenceTtlMs: 60_000, port, hostname: '127.0.0.1' })`
  is constructed
- **THEN**
  `(instance as unknown as { _maxPersistenceTtlMs: number })._maxPersistenceTtlMs === 60_000`

#### Scenario: NoOp accepts maxPersistenceTtlMs without observable effect

- **WHEN**
  `new CachePersistenceNoop({ maxPersistenceTtlMs: 60_000, staleRetention: 'retain' })`
  is constructed, `put` is awaited, and `get` is consumed
- **THEN** construction does not throw, `put` returns `false`, and `get` yields
  zero entries

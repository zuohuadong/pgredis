# pgredis

PostgreSQL-only application infrastructure toolkit for projects that want to
replace a Redis + PostgreSQL stack with PostgreSQL alone.

`pgredis` is not a Redis protocol-compatible client and is not a drop-in
replacement for `ioredis`, `node-redis`, Bull, or Redis Cluster. It replaces the
Redis infrastructure use cases with PostgreSQL-friendly primitives.

It provides:

- KV/TTL cache
- atomic counters
- hash, set, list, and sorted-set helpers
- cursor-style scans and structure-level TTL for collection helpers
- Pub/Sub helpers via PostgreSQL `LISTEN/NOTIFY`
- transaction-scoped advisory locks
- fixed-window, sliding-window, and token-bucket rate limiting
- a simple `pg-boss` queue adapter for background jobs and long tasks
- a `createPgredis()` facade for one-shot initialization, health, stats, and cleanup

## Installation

`@postgresx/noredis` itself has no required runtime dependencies. Install runtime-specific
packages only for the adapters or features you use.

### Bun.js

Base toolkit with `Bun.SQL`:

```bash
bun add @postgresx/noredis
```

```ts
import { SQL } from "bun";
import { createPgredis } from "@postgresx/noredis";
import { createBunSqlAdapter } from "@postgresx/noredis/adapters/bun";

const sql = createBunSqlAdapter(new SQL(process.env.DATABASE_URL!));
const pg = createPgredis({ sql, namespace: "app" });
```

Bun realtime `LISTEN/NOTIFY`:

```bash
bun add @postgresx/noredis @postgresx/bun-listen
```

```ts
import { createBunPgListener, publishPgNotify } from "@postgresx/noredis";

const listener = createBunPgListener(process.env.DATABASE_URL!, {
  channels: ["cache_invalidate"],
  onNotify(channel, payload) {
    console.log(channel, payload);
  }
});

await publishPgNotify(sql, "cache_invalidate", { key: "token:abc" });
listener.close();
```

Install only the Bun-native listener when you do not need the rest of the
toolkit:

```bash
bun add @postgresx/bun-listen
```

```ts
import { createPgListener } from "@postgresx/bun-listen";

const listener = createPgListener(process.env.DATABASE_URL!, ["events"], (_channel, payload) => {
  console.log(payload);
});
```

### Node.js

Base toolkit with `pg`:

```bash
npm install @postgresx/noredis pg
```

```ts
import { createPgredis } from "@postgresx/noredis";
import { createPgAdapter } from "@postgresx/noredis/adapters/node";

const sql = createPgAdapter(process.env.DATABASE_URL!);
const pg = createPgredis({ sql, namespace: "app" });
```

Node.js `LISTEN/NOTIFY`:

```ts
import { createPgNodeListener } from "@postgresx/noredis/adapters/node";

const listener = createPgNodeListener(process.env.DATABASE_URL!, {
  channels: ["cache_invalidate"],
  onNotify(channel, payload) {
    console.log(channel, payload);
  }
});
```

Queues with `pg-boss`:

```bash
npm install @postgresx/noredis pg pg-boss
```

## KV/TTL Cache

```ts
import { createPgKvCache } from "@postgresx/noredis";

const cache = createPgKvCache({
  sql,
  namespace: "auth",
  l1: { max: 10_000, ttlMs: 60_000 }
});

await cache.ensureSchema();
await cache.set("token:abc", { userId: 1 }, { ttlMs: 60_000 });
const value = await cache.get<{ userId: number }>("token:abc");
```

## Unified client

```ts
import { createPgredis } from "@postgresx/noredis";

const pg = createPgredis({
  sql,
  namespace: "app",
  rateLimit: { limit: 60, windowMs: 60_000 },
  queue: {
    connectionString: process.env.DATABASE_URL,
    schema: "pgboss"
  }
});

await pg.ensureSchema();

await pg.cache.set("token:abc", { userId: 1 }, { ttlMs: 60_000 });
await pg.counter.incr("daily:requests");
await pg.hash.hset("session:abc", "userId", 1);
await pg.set.sadd("online-users", "1");
await pg.list.rpush("recent-events", { id: "evt_1" });
await pg.sortedSet.zadd("leaderboard", 100, "user:1");
await pg.hash.expire("session:abc", 60_000);
await pg.hash.hscan("session:abc", null, 100);
await pg.health();
await pg.stats();
const stopCleanup = pg.startCleanupWorker({ intervalMs: 60_000 });
```

## Pub/Sub

Publishing uses only the configured SQL adapter. Bun LISTEN/NOTIFY consumption
uses the separate `@postgresx/bun-listen` package and loads it dynamically.

```bash
bun add @postgresx/bun-listen
```

```ts
import { createBunPgListener, publishPgNotify } from "@postgresx/noredis";

createBunPgListener(databaseUrl, ["cache_invalidate"], (_channel, payload) => {
  console.log(payload);
});

await publishPgNotify(sql, "cache_invalidate", { key: "token:abc" });
```

Node.js can use the `pg`-based listener from the adapter subpath:

```ts
import { createPgNodeListener } from "@postgresx/noredis/adapters/node";

createPgNodeListener(process.env.DATABASE_URL!, {
  channels: ["cache_invalidate"],
  onNotify(_channel, payload) {
    console.log(payload);
  }
});
```

## Advisory lock

`withPgAdvisoryLock` uses transaction-scoped locks, so locks are released by
PostgreSQL when the transaction ends.

```ts
import { withPgAdvisoryLock } from "@postgresx/noredis";

await withPgAdvisoryLock(sql, "billing:flush", async (tx) => {
  await tx.unsafe("SELECT 1");
});
```

## Rate limit

```ts
import { createPgFixedWindowRateLimiter } from "@postgresx/noredis";

const limiter = createPgFixedWindowRateLimiter({
  sql,
  namespace: "api",
  limit: 60,
  windowMs: 60_000
});

await limiter.ensureSchema();
const result = await limiter.hit("user:1");
```

## Queue

```ts
import { createPgBossJobQueue } from "@postgresx/noredis";

const queue = createPgBossJobQueue({
  connectionString: process.env.DATABASE_URL,
  schema: "pgboss",
  queues: {
    "webhook.deliver": { retryLimit: 5, retryBackoff: true }
  }
});

await queue.start();
await queue.send("webhook.deliver", { event: "created" });
await queue.work("webhook.deliver", { batchSize: 1 }, async (jobs) => {
  for (const job of jobs) console.log(job.data);
});
```

`pg-boss` is loaded dynamically and is not a runtime dependency of `@postgresx/noredis`.
Install it only when queue features are used:

```bash
npm install @postgresx/noredis pg-boss
```

`@postgresx/noredis` intentionally keeps the queue API close to `pg-boss`:

- `start()` starts `pg-boss` and creates configured queues.
- `ensureQueue()` creates or updates queue metadata.
- `send()` enqueues jobs.
- `work()` registers workers.
- `getBoss()` returns the underlying `PgBoss` instance for advanced cases.

This covers Redis-backed background job use cases such as Bull-style async
webhooks, billing flushes, retries, and long tasks. It does not emulate Redis
Streams commands.

## Launch readiness

Current local verification:

- `bun run build` passes for `@postgresx/bun-listen` and `@postgresx/noredis`.
- `bun test packages/` passes the package test suite.
- `bun run check` passes TypeScript checks.

Remaining gates before a production or 1.0 launch:

| Area | Status | Why it matters | Recommended action |
| --- | --- | --- | --- |
| Real database coverage | Added in CI | PostgreSQL DDL, indexes, transactions, JSONB behavior, and LISTEN/NOTIFY reconnect behavior need real database coverage. | CI runs `bun run test:integration` against PostgreSQL 16. Run locally with `TEST_DATABASE_URL` when debugging. |
| Benchmark baseline | Pending CI run | `benchmark.md` has not been generated yet, so there is no measured Redis vs PostgreSQL baseline to set user expectations. | Run the manual benchmark workflow before release; local benchmark runs are optional. |
| Install smoke test | Added in CI | Build output exists, but the published package shape should be verified from a packed tarball, including subpath exports. | CI runs `bun run smoke:pack` to import packed tarballs from clean Node and Bun entrypoints. |
| Release credentials | Guarded in workflows | Release Please and npm publish depend on repository secrets and npm provenance setup. | Workflows fail early when `RELEASE_PAT` or `NPM_TOKEN` is missing; still verify package access before the first release. |
| Runtime operations | Documented | Cleanup, table growth, queue lag, and listener health are app-operational concerns. | See `docs/production-runbook.md` for cleanup, bloat checks, listener health, queue monitoring, and rollback guidance. |

The package is suitable for an early beta once CI passes and the benchmark
workflow has produced a baseline. It should not be described as a drop-in Redis
or ioredis replacement.

## ioredis comparison

`ioredis` is a Redis protocol client. `pgredis` is a PostgreSQL-native toolkit
that replaces common Redis-backed application primitives without speaking the
Redis protocol or supporting every Redis command.

| Capability | ioredis | pgredis | Launch implication |
| --- | --- | --- | --- |
| Protocol and command surface | Sends Redis commands and supports arbitrary Redis command methods. | Exposes typed PostgreSQL-backed primitives only. | Migration requires code changes. Redis command compatibility is intentionally out of scope. |
| Runtime dependency | Requires Redis, Redis-compatible service, or Redis Cluster/Sentinel. | Requires PostgreSQL; optional `pg`, `pg-boss`, or `@postgresx/bun-listen` only for selected features. | Good fit for teams removing a separate Redis tier. |
| Strings / KV / TTL | Full Redis string command surface. | JSONB KV cache with TTL, batch get/set, prefix clear, optional local L1 cache, and notification invalidation. | Covers cache/session-style values, but not byte-string commands such as `APPEND`, `GETRANGE`, or `SETRANGE`. |
| Hashes, lists, sets, sorted sets | Native Redis data structures and command coverage. | PostgreSQL table-backed helpers for common hash/list/set/zset operations. | Covers common app usage; advanced/blocking/list mutation and full command parity are not complete. |
| Pub/Sub | Redis Pub/Sub, pattern subscriptions, binary messages, cluster behavior. | PostgreSQL `LISTEN/NOTIFY` publisher and Node/Bun listeners. | Good for lightweight invalidation/events; not durable and limited by PostgreSQL NOTIFY payload size. |
| Streams / consumer groups | Redis Streams commands such as `XADD` and consumer groups. | No Redis Streams API; queues are delegated to `pg-boss`. | Add a durable outbox/stream API if event-log semantics are required. |
| Pipelining / transactions | `pipeline`, `multi`, `exec`, and cluster-aware behavior. | Batch helpers exist for some primitives; no generic pipeline or Redis-style transaction facade. | Add a pgredis batch/pipeline facade for migration ergonomics. |
| Lua scripting / Redis Functions | Supports scripting commands and custom command definitions. | Out of scope; use SQL, stored procedures, or application code. | Do not port Lua directly; rewrite as SQL/app logic. |
| Cluster / Sentinel / NAT mapping | Built into ioredis. | Inherited from PostgreSQL HA, pooling, and networking. | Document PostgreSQL deployment assumptions instead of Redis HA options. |
| TLS / ACL / auth | Redis connection, TLS, and ACL options. | Delegated to PostgreSQL driver, DSN, and database roles. | Use PostgreSQL credentials and transport settings. |
| Redis Stack modules | Can send module commands, depending on Redis server support. | No RedisJSON, RediSearch, RedisTimeSeries, RedisBloom facade. | Prefer PostgreSQL JSONB, full-text search, pgvector, PostGIS, or extensions. |
| Offline queue / reconnect strategy | Client-level offline queue, retry, ready checks, auto-resubscribe. | Node/Bun listeners include reconnect and health state; SQL operations depend on the database adapter/pool behavior. | Add operation-level retry guidance and adapter smoke tests. |

## Redis feature coverage

Redis has a broad surface area across core data types, server operations,
programmability, clustering, modules, and observability. `pgredis` targets
feature replacement, not command compatibility.

| Redis capability | pgredis status | Replacement strategy | Gap |
| --- | --- | --- | --- |
| String `GET`/`SET`/`DEL`/TTL | Covered | `PgKvCache` stores JSONB values with optional TTL and L1 cache | No byte-level Redis string ops such as `APPEND`, `GETRANGE`, `SETRANGE` |
| Key expiration | Covered | `expires_at`, `cleanupExpired`, L1 TTL | No Redis passive/active eviction semantics or keyspace notifications |
| Batch get/set | Covered | `mget`, `mset` | No pipelining API yet |
| Atomic counters | Covered | `PgCounter` over BIGINT UPSERT | Integer counters only |
| Pub/Sub | Covered | `LISTEN/NOTIFY` plus `createPgListener` | Not durable, payload size is limited by PostgreSQL NOTIFY |
| Distributed locks | Covered | Transaction-scoped advisory locks | No Redlock-compatible lease renewal model |
| Fixed-window rate limit | Covered | UPSERT counter table with window reset metadata | Covered for coarse windows |
| Sliding-window rate limit | Covered | Bucketed moving-window counters | Precision depends on configured bucket size |
| Token-bucket rate limit | Covered | PostgreSQL row state with refill calculation | Designed for app-level API throttling |
| Queues / delayed jobs / retries | Covered via adapter | `pg-boss` wrapper | Not Redis Streams compatible |
| Hashes | Covered | `PgHash` over `(namespace, key, field)` rows | `HSCAN`-style cursor scan and key TTL covered; no per-field TTL |
| Lists | Covered | `PgList` over ordered rows | Cursor scan and key TTL covered; no blocking pop; use pg-boss for real job queues |
| Sets | Covered | `PgSet` over unique-indexed rows | `SINTER`, `SUNION`, `SDIFF`, cursor scan, and key TTL covered |
| Sorted sets | Covered | `PgSortedSet` over `(member, score)` rows | Rank, score range, count, pop-min, scan, and key TTL covered |
| Streams / consumer groups | Delegated / missing | Use `pg-boss` for jobs; application table for event logs | No `XADD`, `XREADGROUP`, pending-entry list |
| Transactions / optimistic watch | Missing | Use PostgreSQL transactions and row locks directly | No Redis `MULTI`/`EXEC`/`WATCH` facade |
| Lua scripting / functions | Out of scope | Use SQL, stored procedures, or app code | No Redis Lua/function runtime |
| Bitmaps / bitfields | Missing | Use `bytea`, roaring bitmap extension, or SQL tables | No bit operation API |
| HyperLogLog | Missing | Use PostgreSQL extensions or approximate-count tables | No `PFADD`/`PFCOUNT` |
| Geospatial | Missing | Use PostGIS | No Redis GEO command facade |
| JSON document commands | Partial | KV values are JSONB | No RedisJSON path mutation/query API |
| Search / vector search | Missing | Use PostgreSQL full-text search, `pg_trgm`, `pgvector` | No RediSearch-compatible query API |
| Time series | Missing | Use hypertables/partitioned tables/TimescaleDB | No RedisTimeSeries API |
| Bloom / Cuckoo / Count-Min | Missing | Use PostgreSQL extensions or app tables | No RedisBloom-compatible API |
| ACL/auth | Out of scope | Use PostgreSQL credentials and application auth | No Redis ACL facade |
| Persistence/replication/cluster | Out of scope | Inherited from PostgreSQL deployment | No Redis Cluster slot/hash semantics |
| Server introspection | Partial | `createPgredis().health()` and `stats()` expose basic health/cache/queue stats | No Redis `INFO`, `MONITOR`, command stats facade |

## Missing pieces to consider next

The highest-value additions for Redis replacement are now:

1. PostgreSQL integration test suite and tarball install smoke tests.
2. Generic `batch()` or `pipeline()` facade for grouping pgredis operations.
3. Durable outbox/stream API for applications that currently use Redis Streams.
4. Blocking list pop or explicit queue-first migration guidance for worker pulls.
5. Production metrics for table sizes, cleanup counts, TTL backlog, listener reconnects, and queue lag.
6. Redis-style migration aliases for the most common commands, without claiming protocol compatibility.
7. Framework adapters such as session stores for Express/Fastify/Elysia and cache helpers for common web stacks.
8. More KV options: `set` NX/XX semantics, compare-and-swap, touch/expire helpers, and configurable serialization.

## Design notes

This is a toolkit, not a Redis-compatible client. It intentionally exposes
PostgreSQL-friendly semantics:

- locks are transaction-scoped advisory locks
- pub/sub is `LISTEN/NOTIFY`, not durable messaging
- queues are delegated to `pg-boss`
- KV values are JSONB rows with optional local L1 caching

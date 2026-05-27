# pgredis

> 🌐 **English | [中文](#中文)**

PostgreSQL-only application infrastructure toolkit for projects that want to
replace a Redis + PostgreSQL stack with PostgreSQL alone.

`pgredis` is not a Redis protocol-compatible client and is not a drop-in
replacement for `ioredis`, `node-redis`, Bull, or Redis Cluster. It replaces the
Redis infrastructure use cases with PostgreSQL-friendly primitives.

It provides:

- KV/TTL cache
- KV conditional writes: `NX`/`XX`, compare-and-swap, `expire`, `persist`, `touch`, and pluggable serialization
- atomic counters
- hash, set, list, and sorted-set helpers
- cursor-style scans and structure-level TTL for collection helpers
- Pub/Sub helpers via PostgreSQL `LISTEN/NOTIFY`
- transaction-scoped advisory locks
- fixed-window, sliding-window, and token-bucket rate limiting
- a simple `pg-boss` queue adapter for background jobs and long tasks
- a durable outbox/stream helper for event-log style processing
- Redis-style migration aliases for common commands, without protocol compatibility claims
- framework-neutral session stores and cache helpers for Express/Fastify/Elysia-style stacks
- a `createPgredis()` facade for one-shot initialization, `batch()`/`pipeline()`, health, stats, metrics, and cleanup

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

await cache.set("token:abc", { userId: 2 }, { nx: true }); // only when missing
await cache.set("token:abc", { userId: 3 }, { xx: true }); // only when present
await cache.compareAndSwap("token:abc", { userId: 3 }, { userId: 4 });
await cache.expire("token:abc", 60_000);
await cache.persist("token:abc");
await cache.touch("token:abc");
```

Use `serializer` when values need an application envelope before they are stored
as JSONB:

```ts
const cache = createPgKvCache({
  sql,
  serializer: {
    serialize(value) {
      return { v: 1, value };
    },
    deserialize(row) {
      return (row as { value: unknown }).value;
    }
  }
});
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
await pg.metrics();
const stopCleanup = pg.startCleanupWorker({ intervalMs: 60_000 });
```

`batch()` runs a callback inside the SQL adapter transaction when the adapter
supports `begin()`. `pipeline()` is an ergonomic ordered-operation facade for
migration work; it is not a Redis wire protocol pipeline.

```ts
const result = await pg.batch(async (tx) => {
  await tx.cache.set("session:abc", { userId: 1 });
  return tx.cache.get("session:abc");
});

const results = await pg.pipeline()
  .set("counter-cache", 1)
  .get("counter-cache")
  .incr("daily:requests")
  .exec();
```

Common Redis-style aliases are available under `pg.redis` for migration
ergonomics:

```ts
await pg.redis.set("session:abc", { userId: 1 }, { PX: 60_000, NX: true });
await pg.redis.get("session:abc");
await pg.redis.hset("profile:1", "name", "Ada");
await pg.redis.blpop("worker:list", 5);
```

These aliases call typed pgredis primitives and do not make the package Redis
protocol compatible.

### ioredis and node-redis facades

For code that expects a Redis client-shaped object, use the additive adapter
subpaths. They expose a whitelist of high-frequency `ioredis` lower-case
methods and node-redis camelCase methods while still requiring an existing
`PgredisClient`.

```ts
import { createIoredisAdapter } from "@postgresx/noredis/adapters/ioredis";
import { createRedisJsAdapter } from "@postgresx/noredis/adapters/redis";

const ioredisLike = createIoredisAdapter({ client: pg });
const redisJsLike = createRedisJsAdapter({ client: pg });

await ioredisLike.set("cache:user:1", "Ada", "EX", 60, "NX");
await redisJsLike.hSet("profile:1", "name", "Ada");
```

The facades are useful for cache-manager-style `get`/`set`/`del`/`mget`/`mset`
calls and simple Pub/Sub publishing. They do not create a Redis TCP connection,
do not implement `EVAL`/Lua, Cluster, Sentinel, `WATCH`, Redis Streams consumer
groups, or server administration commands. Unsupported commands throw
`UnsupportedCommandError` instead of silently pretending to work.

The typed primitives are also available from explicit subpaths:
`@postgresx/noredis/kv`, `hash`, `set`, `sorted-set`, `list`, and `pubsub`.

If package-name aliasing is useful during migration, use the thin re-export
packages `@postgresx/noredis-ioredis` and `@postgresx/noredis-redis`. They are
still facades over `PgredisClient`; they do not provide drop-in constructors.

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

## Durable outbox / stream

Use `PgOutboxStream` when an application previously used Redis Streams for a
durable event log or worker inbox. It intentionally exposes PostgreSQL outbox
semantics instead of Redis consumer-group compatibility.

```ts
await pg.outbox.append("billing.events", { invoiceId: "inv_1" });

const messages = await pg.outbox.claim("billing.events", "worker-a", {
  limit: 10,
  visibilityTimeoutMs: 30_000
});

for (const message of messages) {
  await deliver(message.payload);
  await pg.outbox.ack([message.id]);
}
```

For job queues, retries, and scheduling, prefer the `pg-boss` queue adapter.
Use list `blpop()` / `brpop()` only as a migration bridge for simple worker
pulls; it polls PostgreSQL and is not a queue scheduler.

## Web adapters

The web adapter subpath has no Express, Fastify, or Elysia runtime dependency.
It exports framework-neutral helpers that match common session-store and
read-through cache shapes:

```ts
import {
  createElysiaSessionStore,
  createPgredisCacheHelpers
} from "@postgresx/noredis/adapters/web";

const sessions = createElysiaSessionStore(pg.cache, {
  prefix: "sess:",
  ttlMs: 24 * 60 * 60 * 1000
});

const cache = createPgredisCacheHelpers(pg.cache, {
  prefix: "http:",
  ttlMs: 60_000
});

const profile = await cache.wrap("profile:1", () => loadProfile("1"));
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
Streams commands. Use `pg.outbox` for event-log processing and `pg.queue` for
queue-first worker migration.

## Launch readiness

Current local verification:

- `bun run build` passes for `@postgresx/bun-listen` and `@postgresx/noredis`.
- `bun test packages/` passes the package test suite.
- `bun run check` passes TypeScript checks.

Remaining gates before a production or 1.0 launch:

| Area | Status | Why it matters | Recommended action |
| --- | --- | --- | --- |
| Real database coverage | Added in CI | PostgreSQL DDL, indexes, transactions, JSONB behavior, and LISTEN/NOTIFY reconnect behavior need real database coverage. | CI runs `bun run test:integration` against PostgreSQL 16. Run locally with `TEST_DATABASE_URL` when debugging. |
| Benchmark baseline | Generated | `benchmark.md` is generated by GitHub Actions and includes both service-level PostgreSQL columns and L1 hot-read columns. | Benchmark-relevant changes refresh it automatically; local benchmark runs are optional. |
| Install smoke test | Added in CI | Build output exists, but the published package shape should be verified from a packed tarball, including subpath exports. | CI runs `bun run smoke:pack` to import packed tarballs from clean Node and Bun entrypoints. |
| Release credentials | Guarded in workflows | Release Please and npm publish depend on repository secrets and npm provenance setup. | Workflows fail early when `RELEASE_PAT` or `NPM_TOKEN` is missing; still verify package access before the first release. |
| Runtime operations | Documented | Cleanup, table growth, queue lag, and listener health are app-operational concerns. | See `docs/production-runbook.md` for cleanup, bloat checks, listener health, queue monitoring, and rollback guidance. |

The package is suitable for an early beta once CI passes and the benchmark
baseline remains refreshable. It should not be described as a drop-in Redis or
ioredis replacement.

## ioredis comparison

`ioredis` is a Redis protocol client. `pgredis` is a PostgreSQL-native toolkit
that replaces common Redis-backed application primitives without speaking the
Redis protocol or supporting every Redis command.

| Capability | ioredis | pgredis | Launch implication |
| --- | --- | --- | --- |
| Protocol and command surface | Sends Redis commands and supports arbitrary Redis command methods. | Exposes typed PostgreSQL-backed primitives only. | Migration requires code changes. Redis command compatibility is intentionally out of scope. |
| Runtime dependency | Requires Redis, Redis-compatible service, or Redis Cluster/Sentinel. | Requires PostgreSQL; optional `pg`, `pg-boss`, or `@postgresx/bun-listen` only for selected features. | Good fit for teams removing a separate Redis tier. |
| Strings / KV / TTL | Full Redis string command surface. | JSONB KV cache with TTL, batch get/set, prefix clear, optional local L1 cache, notification invalidation, `NX`/`XX`, CAS, `expire`, `persist`, `touch`, and pluggable serialization. | Covers cache/session-style values, but not byte-string commands such as `APPEND`, `GETRANGE`, or `SETRANGE`. |
| Hashes, lists, sets, sorted sets | Native Redis data structures and command coverage. | PostgreSQL table-backed helpers for common hash/list/set/zset operations. | Covers common app usage; list blocking pop is a polling migration bridge, not a scheduler. |
| Pub/Sub | Redis Pub/Sub, pattern subscriptions, binary messages, cluster behavior. | PostgreSQL `LISTEN/NOTIFY` publisher and Node/Bun listeners. | Good for lightweight invalidation/events; not durable and limited by PostgreSQL NOTIFY payload size. |
| Streams / consumer groups | Redis Streams commands such as `XADD` and consumer groups. | Durable outbox/stream helper plus `pg-boss` queue adapter. | No Redis consumer-group protocol or pending-entry-list compatibility. |
| Pipelining / transactions | `pipeline`, `multi`, `exec`, and cluster-aware behavior. | `batch()` uses SQL adapter transactions when available; `pipeline()` executes ordered pgredis operations. | No Redis wire-level pipeline or `WATCH` semantics. |
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
| Batch get/set | Covered | `mget`, `mset`, `batch()`, and `pipeline()` | Pipeline groups pgredis operations, not Redis commands |
| Atomic counters | Covered | `PgCounter` over BIGINT UPSERT | Integer counters only |
| Pub/Sub | Covered | `LISTEN/NOTIFY` plus `createPgListener` | Not durable, payload size is limited by PostgreSQL NOTIFY |
| Distributed locks | Covered | Transaction-scoped advisory locks | No Redlock-compatible lease renewal model |
| Fixed-window rate limit | Covered | UPSERT counter table with window reset metadata | Covered for coarse windows |
| Sliding-window rate limit | Covered | Bucketed moving-window counters | Precision depends on configured bucket size |
| Token-bucket rate limit | Covered | PostgreSQL row state with refill calculation | Designed for app-level API throttling |
| Queues / delayed jobs / retries | Covered via adapter | `pg-boss` wrapper | Not Redis Streams compatible |
| Hashes | Covered | `PgHash` over `(namespace, key, field)` rows | `HSCAN`-style cursor scan and key TTL covered; no per-field TTL |
| Lists | Covered | `PgList` over ordered rows | Cursor scan, key TTL, and polling `blpop`/`brpop`; use pg-boss for real job queues |
| Sets | Covered | `PgSet` over unique-indexed rows | `SINTER`, `SUNION`, `SDIFF`, `SPOP`, `SRANDMEMBER`, `SMOVE`, cursor scan, and key TTL covered |
| Sorted sets | Covered | `PgSortedSet` over `(member, score)` rows | Rank, score range, count, increment, pop-min/max, scan, and key TTL covered |
| Streams / consumer groups | Partially covered | Use `PgOutboxStream` for event logs and `pg-boss` for jobs | No Redis `XREADGROUP` or pending-entry-list compatibility |
| Transactions / optimistic watch | Partially covered | Use `batch()` for adapter transactions; use PostgreSQL row locks directly for optimistic flows | No Redis `WATCH` facade |
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
| Server introspection | Partial | `createPgredis().health()`, `stats()`, and `metrics()` expose health, cleanup, table size, TTL backlog, listener, and queue views | No Redis `INFO`, `MONITOR`, command stats facade |

## Missing pieces to consider next

The highest-value migration features now have first-pass APIs and tests:
PostgreSQL integration coverage, tarball smoke tests, `batch()`/`pipeline()`,
outbox/stream, list blocking-pop helpers, production metrics, Redis-style
aliases, web adapters, and expanded KV write semantics.

Remaining candidates:

1. Redis Streams consumer-group migration guide with side-by-side patterns for `XREADGROUP`, pending entries, and retries.
2. More framework-specific examples for popular session middleware packages.
3. Operation-level retry/backoff helpers for SQL adapters.
4. Benchmark baselines for outbox, list pop, and pipeline workloads.

## Design notes

This is a toolkit, not a Redis-compatible client. It intentionally exposes
PostgreSQL-friendly semantics:

- locks are transaction-scoped advisory locks
- pub/sub is `LISTEN/NOTIFY`, not durable messaging
- queues are delegated to `pg-boss`
- KV values are JSONB rows with optional local L1 caching

---

## 中文

> 🌐 [English](#pgredis) | **中文**

`pgredis` 是一个纯 PostgreSQL 的应用基础设施工具包，旨在帮助项目从 Redis + PostgreSQL 架构迁移到仅使用 PostgreSQL。

`pgredis` 不是 Redis 协议兼容客户端，也不是 `ioredis`、`node-redis`、Bull 或 Redis Cluster 的即插即用替代品。它使用 PostgreSQL 友好的原语来替代 Redis 的基础设施用例。

功能包括：

- KV/TTL 缓存
- KV 条件写入：`NX`/`XX`、比较并交换、`expire`、`persist`、`touch` 和可插拔序列化
- 原子计数器
- 哈希、集合、列表和有序集合辅助函数
- 游标式扫描和集合辅助函数的结构级 TTL
- 通过 PostgreSQL `LISTEN/NOTIFY` 实现的 Pub/Sub 辅助函数
- 事务作用域的咨询锁
- 固定窗口、滑动窗口和令牌桶限流
- 简单的 `pg-boss` 队列适配器，用于后台任务和长任务
- 用于事件日志式处理的持久化 outbox/stream 辅助函数
- 常见命令的 Redis 风格迁移别名，但不声明协议兼容
- 面向 Express/Fastify/Elysia 风格栈的框架中立 session store 和 cache helper
- `createPgredis()` 外观，用于一次性初始化、`batch()`/`pipeline()`、健康检查、统计、指标和清理

## 安装

`@postgresx/noredis` 本身没有必需的运行时依赖。请仅为你使用的适配器或功能安装特定的运行时包。

### Bun.js

使用 `Bun.SQL` 的基础工具包：

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

Bun 实时 `LISTEN/NOTIFY`：

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

当你不需要其余工具包时，仅安装 Bun 原生监听器：

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

使用 `pg` 的基础工具包：

```bash
npm install @postgresx/noredis pg
```

```ts
import { createPgredis } from "@postgresx/noredis";
import { createPgAdapter } from "@postgresx/noredis/adapters/node";

const sql = createPgAdapter(process.env.DATABASE_URL!);
const pg = createPgredis({ sql, namespace: "app" });
```

Node.js `LISTEN/NOTIFY`：

```ts
import { createPgNodeListener } from "@postgresx/noredis/adapters/node";

const listener = createPgNodeListener(process.env.DATABASE_URL!, {
  channels: ["cache_invalidate"],
  onNotify(channel, payload) {
    console.log(channel, payload);
  }
});
```

使用 `pg-boss` 的队列：

```bash
npm install @postgresx/noredis pg pg-boss
```

## KV/TTL 缓存

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

await cache.set("token:abc", { userId: 2 }, { nx: true });
await cache.set("token:abc", { userId: 3 }, { xx: true });
await cache.compareAndSwap("token:abc", { userId: 3 }, { userId: 4 });
await cache.expire("token:abc", 60_000);
await cache.persist("token:abc");
await cache.touch("token:abc");
```

## 统一客户端

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
await pg.metrics();
const stopCleanup = pg.startCleanupWorker({ intervalMs: 60_000 });
```

`batch()` 在 SQL 适配器支持 `begin()` 时会使用事务；`pipeline()` 是迁移时用于顺序分组 pgredis 操作的外观，不是 Redis 协议管道。

```ts
const result = await pg.batch(async (tx) => {
  await tx.cache.set("session:abc", { userId: 1 });
  return tx.cache.get("session:abc");
});

const results = await pg.pipeline()
  .set("counter-cache", 1)
  .get("counter-cache")
  .incr("daily:requests")
  .exec();

await pg.redis.set("session:abc", { userId: 1 }, { PX: 60_000, NX: true });
await pg.redis.blpop("worker:list", 5);
```

### ioredis 和 node-redis 外观适配器

如果现有代码需要 Redis client 形状的对象，可以使用 additive adapter
子路径。它们暴露白名单内的高频 `ioredis` 小写方法和 node-redis camelCase
方法，但仍然需要一个已有的 `PgredisClient`。

```ts
import { createIoredisAdapter } from "@postgresx/noredis/adapters/ioredis";
import { createRedisJsAdapter } from "@postgresx/noredis/adapters/redis";

const ioredisLike = createIoredisAdapter({ client: pg });
const redisJsLike = createRedisJsAdapter({ client: pg });

await ioredisLike.set("cache:user:1", "Ada", "EX", 60, "NX");
await redisJsLike.hSet("profile:1", "name", "Ada");
```

这些外观适合 cache-manager 风格的 `get`/`set`/`del`/`mget`/`mset` 调用和简单 Pub/Sub 发布。
它们不会创建 Redis TCP 连接，也不实现 `EVAL`/Lua、Cluster、Sentinel、`WATCH`、Redis Streams consumer group 或服务器管理命令。
不支持的命令会抛出 `UnsupportedCommandError`。

类型化原语也可以从明确的子路径导入：
`@postgresx/noredis/kv`、`hash`、`set`、`sorted-set`、`list` 和 `pubsub`。

如果迁移时需要包名 alias，可以使用薄 re-export 包
`@postgresx/noredis-ioredis` 和 `@postgresx/noredis-redis`。它们仍然是
`PgredisClient` 之上的外观，不提供即插即用构造器。

## Pub/Sub

发布仅使用配置的 SQL 适配器。Bun LISTEN/NOTIFY 消费使用独立的 `@postgresx/bun-listen` 包，并动态加载。

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

Node.js 可以使用适配器子路径中基于 `pg` 的监听器：

```ts
import { createPgNodeListener } from "@postgresx/noredis/adapters/node";

createPgNodeListener(process.env.DATABASE_URL!, {
  channels: ["cache_invalidate"],
  onNotify(_channel, payload) {
    console.log(payload);
  }
});
```

## 持久化 outbox / stream

当应用过去用 Redis Streams 做持久化事件日志或 worker inbox 时，可以使用 `PgOutboxStream`。它暴露 PostgreSQL outbox 语义，不模拟 Redis consumer group 协议。

```ts
await pg.outbox.append("billing.events", { invoiceId: "inv_1" });

const messages = await pg.outbox.claim("billing.events", "worker-a", {
  limit: 10,
  visibilityTimeoutMs: 30_000
});

for (const message of messages) {
  await deliver(message.payload);
  await pg.outbox.ack([message.id]);
}
```

真实作业队列、重试和调度优先使用 `pg-boss` 队列适配器。列表 `blpop()` / `brpop()` 只适合简单 worker pull 的迁移桥接。

## Web 适配器

`@postgresx/noredis/adapters/web` 不依赖 Express、Fastify 或 Elysia 运行时，只导出常见 session store 和 read-through cache helper 形状：

```ts
import {
  createElysiaSessionStore,
  createPgredisCacheHelpers
} from "@postgresx/noredis/adapters/web";

const sessions = createElysiaSessionStore(pg.cache, {
  prefix: "sess:",
  ttlMs: 24 * 60 * 60 * 1000
});

const cache = createPgredisCacheHelpers(pg.cache, {
  prefix: "http:",
  ttlMs: 60_000
});
```

## 咨询锁

`withPgAdvisoryLock` 使用事务作用域锁，因此当事务结束时，PostgreSQL 会自动释放锁。

```ts
import { withPgAdvisoryLock } from "@postgresx/noredis";

await withPgAdvisoryLock(sql, "billing:flush", async (tx) => {
  await tx.unsafe("SELECT 1");
});
```

## 限流

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

## 队列

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

`pg-boss` 是动态加载的，不是 `@postgresx/noredis` 的运行时依赖。仅在使用队列功能时安装：

```bash
npm install @postgresx/noredis pg-boss
```

`@postgresx/noredis` 有意保持队列 API 与 `pg-boss` 接近：

- `start()` 启动 `pg-boss` 并创建配置的队列。
- `ensureQueue()` 创建或更新队列元数据。
- `send()` 将作业加入队列。
- `work()` 注册工作者。
- `getBoss()` 返回底层的 `PgBoss` 实例，用于高级场景。

这涵盖了 Redis 支持的后台作业用例，如 Bull 风格的异步 webhook、计费刷新、重试和长任务。它不模拟 Redis Streams 命令。事件日志处理使用 `pg.outbox`，队列优先迁移使用 `pg.queue`。

## 发布准备状态

当前本地验证：

- `@postgresx/bun-listen` 和 `@postgresx/noredis` 的 `bun run build` 通过。
- `bun test packages/` 通过包测试套件。
- `bun run check` 通过 TypeScript 检查。

生产环境或 1.0 发布前的剩余检查项：

| 领域 | 状态 | 重要性 | 建议操作 |
| --- | --- | --- | --- |
| 真实数据库覆盖 | CI 中已添加 | PostgreSQL DDL、索引、事务、JSONB 行为和 LISTEN/NOTIFY 重连行为需要真实数据库覆盖。 | CI 针对 PostgreSQL 16 运行 `bun run test:integration`。调试时使用 `TEST_DATABASE_URL` 本地运行。 |
| 基准测试基线 | 已生成 | `benchmark.md` 已由 GitHub Actions 生成，并区分主服务级对比和 L1 热读说明。 | benchmark 相关文件变化会自动刷新；本地基准测试运行是可选的。 |
| 安装冒烟测试 | CI 中已添加 | 构建输出存在，但已发布包的形状应从打包的 tarball 验证，包括子路径导出。 | CI 运行 `bun run smoke:pack` 从干净的 Node 和 Bun 入口点导入打包的 tarball。 |
| 发布凭证 | 在工作流中保护 | Release Please 和 npm publish 依赖仓库密钥和 npm provenance 设置。 | 当 `RELEASE_PAT` 或 `NPM_TOKEN` 缺失时，工作流会提前失败；首次发布前仍需验证包访问权限。 |
| 运行时操作 | 已文档化 | 清理、表增长、队列延迟和监听器健康是应用操作关注点。 | 请参阅 `docs/production-runbook.md` 了解清理、膨胀检查、监听器健康、队列监控和回滚指南。 |

包在 CI 通过且 benchmark 基线保持可刷新后适合早期测试版。不应将其描述为 Redis 或 ioredis 的即插即用替代品。

## ioredis 对比

`ioredis` 是 Redis 协议客户端。`pgredis` 是 PostgreSQL 原生工具包，
在不使用 Redis 协议或支持每个 Redis 命令的情况下替换常见的 Redis 支持的应用原语。

| 能力 | ioredis | pgredis | 发布影响 |
| --- | --- | --- | --- |
| 协议和命令表面 | 发送 Redis 命令并支持任意 Redis 命令方法。 | 仅公开类型化的 PostgreSQL 支持的原语。 | 迁移需要代码更改。Redis 命令兼容性有意不在范围内。 |
| 运行时依赖 | 需要 Redis、Redis 兼容服务或 Redis Cluster/Sentinel。 | 需要 PostgreSQL；仅为选定功能可选安装 `pg`、`pg-boss` 或 `@postgresx/bun-listen`。 | 适合希望移除独立 Redis 层的团队。 |
| 字符串 / KV / TTL | 完整的 Redis 字符串命令表面。 | JSONB KV 缓存，支持 TTL、批量 get/set、前缀清除、可选本地 L1 缓存和通知失效。 | 覆盖缓存/会话样式的值，但不支持字节字符串命令如 `APPEND`、`GETRANGE` 或 `SETRANGE`。 |
| 哈希、列表、集合、有序集合 | 原生 Redis 数据结构和命令覆盖。 | PostgreSQL 表支持的常见 hash/list/set/zset 操作辅助函数。 | 覆盖常见应用用法；高级/阻塞/列表突变和完整命令对等性不完整。 |
| Pub/Sub | Redis Pub/Sub、模式订阅、二进制消息、集群行为。 | PostgreSQL `LISTEN/NOTIFY` 发布者和 Node/Bun 监听器。 | 适用于轻量级失效/事件；不持久且受 PostgreSQL NOTIFY 有效负载大小限制。 |
| 流 / 消费者组 | Redis Streams 命令如 `XADD` 和消费者组。 | 无 Redis Streams API；队列委托给 `pg-boss`。 | 如果需要事件日志语义，请添加持久化 outbox/stream API。 |
| 管道 / 事务 | `pipeline`、`multi`、`exec` 和集群感知行为。 | 某些原语存在批量辅助函数；无通用管道或 Redis 风格事务外观。 | 添加 pgredis 批量/管道外观以提高迁移人体工程学。 |
| Lua 脚本 / Redis Functions | 支持脚本命令和自定义命令定义。 | 不在范围内；使用 SQL、存储过程或应用代码。 | 不要直接移植 Lua；重写为 SQL/应用逻辑。 |
| 集群 / Sentinel / NAT 映射 | 内置在 ioredis 中。 | 继承自 PostgreSQL HA、池化和网络。 | 记录 PostgreSQL 部署假设而非 Redis HA 选项。 |
| TLS / ACL / 认证 | Redis 连接、TLS 和 ACL 选项。 | 委托给 PostgreSQL 驱动、DSN 和数据库角色。 | 使用 PostgreSQL 凭据和传输设置。 |
| Redis Stack 模块 | 可以发送模块命令，取决于 Redis 服务器支持。 | 无 RedisJSON、RediSearch、RedisTimeSeries、RedisBloom 外观。 | 首选 PostgreSQL JSONB、全文搜索、pgvector、PostGIS 或扩展。 |
| 离线队列 / 重连策略 | 客户端级离线队列、重试、就绪检查、自动重新订阅。 | Node/Bun 监听器包括重连和健康状态；SQL 操作取决于数据库适配器/池行为。 | 添加操作级重试指南和适配器冒烟测试。 |

## Redis 功能覆盖

Redis 在核心数据类型、服务器操作、可编程性、集群、模块和可观测性方面具有广泛的表面。`pgredis` 目标是功能替代，而非命令兼容性。

| Redis 能力 | pgredis 状态 | 替代策略 | 差距 |
| --- | --- | --- | --- |
| 字符串 `GET`/`SET`/`DEL`/TTL | 已覆盖 | `PgKvCache` 存储 JSONB 值，支持可选 TTL 和 L1 缓存 | 无字节级 Redis 字符串操作如 `APPEND`、`GETRANGE`、`SETRANGE` |
| 键过期 | 已覆盖 | `expires_at`、`cleanupExpired`、L1 TTL | 无 Redis 被动/主动驱逐语义或键空间通知 |
| 批量 get/set | 已覆盖 | `mget`、`mset`、`batch()` 和 `pipeline()` | Pipeline 分组 pgredis 操作，不是 Redis 协议管道 |
| 原子计数器 | 已覆盖 | `PgCounter` 基于 BIGINT UPSERT | 仅整数计数器 |
| Pub/Sub | 已覆盖 | `LISTEN/NOTIFY` 加上 `createPgListener` | 不持久，有效负载大小受 PostgreSQL NOTIFY 限制 |
| 分布式锁 | 已覆盖 | 事务作用域咨询锁 | 无 Redlock 兼容的租约续期模型 |
| 固定窗口限流 | 已覆盖 | UPSERT 计数器表，带窗口重置元数据 | 适用于粗粒度窗口 |
| 滑动窗口限流 | 已覆盖 | 分桶移动窗口计数器 | 精度取决于配置的桶大小 |
| 令牌桶限流 | 已覆盖 | PostgreSQL 行状态，带补充计算 | 设计用于应用级 API 限流 |
| 队列 / 延迟作业 / 重试 | 通过适配器覆盖 | `pg-boss` 包装器 | 不兼容 Redis Streams |
| 哈希 | 已覆盖 | `PgHash` 基于 `(namespace, key, field)` 行 | 覆盖 `HSCAN` 风格游标扫描和键 TTL；无字段级 TTL |
| 列表 | 已覆盖 | `PgList` 基于有序行 | 覆盖游标扫描、键 TTL 和轮询式 `blpop`/`brpop`；真实作业队列使用 pg-boss |
| 集合 | 已覆盖 | `PgSet` 基于唯一索引行 | 覆盖 `SINTER`、`SUNION`、`SDIFF`、`SPOP`、`SRANDMEMBER`、`SMOVE`、游标扫描和键 TTL |
| 有序集合 | 已覆盖 | `PgSortedSet` 基于 `(member, score)` 行 | 覆盖排名、分数范围、计数、递增、弹出最小/最大值、扫描和键 TTL |
| 流 / 消费者组 | 部分覆盖 | 使用 `PgOutboxStream` 处理事件日志，使用 `pg-boss` 处理作业 | 无 Redis `XREADGROUP` 或待处理条目列表兼容 |
| 事务 / 乐观锁 | 部分覆盖 | 使用 `batch()` 处理适配器事务；乐观流程直接使用 PostgreSQL 行锁 | 无 Redis `WATCH` 外观 |
| Lua 脚本 / 函数 | 不在范围内 | 使用 SQL、存储过程或应用代码 | 无 Redis Lua/函数运行时 |
| 位图 / 位域 | 缺失 | 使用 `bytea`、roaring bitmap 扩展或 SQL 表 | 无位操作 API |
| HyperLogLog | 缺失 | 使用 PostgreSQL 扩展或近似计数表 | 无 `PFADD`/`PFCOUNT` |
| 地理空间 | 缺失 | 使用 PostGIS | 无 Redis GEO 命令外观 |
| JSON 文档命令 | 部分 | KV 值为 JSONB | 无 RedisJSON 路径突变/查询 API |
| 搜索 / 向量搜索 | 缺失 | 使用 PostgreSQL 全文搜索、`pg_trgm`、`pgvector` | 无 RediSearch 兼容查询 API |
| 时间序列 | 缺失 | 使用 hypertables/分区表/TimescaleDB | 无 RedisTimeSeries API |
| Bloom / Cuckoo / Count-Min | 缺失 | 使用 PostgreSQL 扩展或应用表 | 无 RedisBloom 兼容 API |
| ACL/认证 | 不在范围内 | 使用 PostgreSQL 凭据和应用认证 | 无 Redis ACL 外观 |
| 持久化/复制/集群 | 不在范围内 | 继承自 PostgreSQL 部署 | 无 Redis Cluster 槽/哈希语义 |
| 服务器内省 | 部分 | `createPgredis().health()`、`stats()` 和 `metrics()` 暴露健康、清理、表大小、TTL backlog、listener 和队列视图 | 无 Redis `INFO`、`MONITOR`、命令统计外观 |

## 下一步考虑的缺失功能

Redis 替代的最高价值新增功能：

1. PostgreSQL 集成测试套件和 tarball 安装冒烟测试。
2. 通用 `batch()` 或 `pipeline()` 外观，用于分组 pgredis 操作。
3. 持久化 outbox/stream API，用于当前使用 Redis Streams 的应用。
4. 阻塞列表弹出或显式队列优先迁移指南，用于工作者拉取。
5. 生产指标，用于表大小、清理计数、TTL 积压、监听器重连和队列延迟。
6. Redis 风格的迁移别名，用于最常见的命令，不声称协议兼容性。
7. 框架适配器，如 Express/Fastify/Elysia 的会话存储和常见 Web 栈的缓存辅助函数。
8. 更多 KV 选项：`set` NX/XX 语义、比较并交换、touch/expire 辅助函数和可配置序列化。

## 设计说明

这是一个工具包，不是 Redis 兼容客户端。它有意公开 PostgreSQL 友好的语义：

- 锁是事务作用域的咨询锁
- pub/sub 是 `LISTEN/NOTIFY`，不是持久消息传递
- 队列委托给 `pg-boss`
- KV 值是 JSONB 行，支持可选本地 L1 缓存

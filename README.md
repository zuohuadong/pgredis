# pgredis

`pgredis` is a PostgreSQL-backed replacement toolkit for projects that want to
remove Redis from a Redis + PostgreSQL architecture. It targets functional
replacement, not Redis protocol or command compatibility.

This repository publishes two packages:

- `@postgresx/noredis`: KV/TTL cache, collections, counters, advisory locks, rate limiting,
  PostgreSQL pub/sub helpers, and a thin `pg-boss` queue wrapper.
- `@postgresx/bun-listen`: a Bun-native PostgreSQL `LISTEN/NOTIFY` client using
  `Bun.connect()`. It is a subpackage and can be installed independently.

Runtime adapters:

- Bun: use `Bun.SQL` through `@postgresx/noredis/adapters/bun`, and use
  `@postgresx/bun-listen` for low-level realtime notifications.
- Node.js: use the `pg` package through `@postgresx/noredis/adapters/node`.

The published `@postgresx/noredis` package does not install `pg`, `pg-boss`, Redis clients,
or `@postgresx/bun-listen` for you. Install those only for the features you use.

## Installation

`@postgresx/noredis` has no required runtime dependencies. Install the database driver or
realtime package only for the runtime features you use.

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
const redis = createPgredis({ sql, namespace: "app" });

await redis.ensureSchema();
await redis.cache.set("session:abc", { userId: 1 }, { ttlMs: 60_000 });
const session = await redis.cache.get<{ userId: number }>("session:abc");
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

await publishPgNotify(sql, "cache_invalidate", { key: "session:abc" });
listener.close();
```

Use only the Bun realtime subpackage:

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
const redis = createPgredis({ sql, namespace: "app" });

await redis.ensureSchema();
await redis.counter.incr("daily:requests");
await sql.close();
```

Node.js `LISTEN/NOTIFY`:

```ts
import { createPgNodeListener } from "@postgresx/noredis/adapters/node";

const listener = createPgNodeListener(process.env.DATABASE_URL!, {
  channels: ["events"],
  onNotify(channel, payload) {
    console.log(channel, payload);
  }
});
```

Queues with `pg-boss`:

```bash
npm install @postgresx/noredis pg pg-boss
```

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
await queue.send("webhook.deliver", { id: "evt_1" });
```

## Development

```bash
bun install
bun run build
bun test packages/
bun run check
```

## Benchmark

Benchmarks compare the same operation groups against Redis and PostgreSQL on
the same GitHub Actions runner. Run locally with:

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/pgredis \
REDIS_URL=redis://127.0.0.1:6379 \
bun run benchmark
```

The benchmark writes results to `benchmark.md`. The GitHub Actions benchmark
workflow is manual and also uploads the generated document as an artifact.
`ioredis` is installed only in this repository as a benchmark/dev dependency;
it is not a runtime dependency of the published `@postgresx/noredis` package.

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
| Documentation parity | Partial | The package README has deeper feature coverage than this repository README. | Keep root and package README aligned for Redis replacement boundaries and migration guidance. |
| Release credentials | Guarded in workflows | Release Please and npm publish depend on repository secrets and npm provenance setup. | Workflows fail early when `RELEASE_PAT` or `NPM_TOKEN` is missing; still verify package access before the first release. |
| Runtime operations | Documented | Cleanup, table growth, queue lag, and listener health are app-operational concerns. | See `docs/production-runbook.md` for cleanup, bloat checks, listener health, queue monitoring, and rollback guidance. |

The project is suitable for an early beta once CI passes and the benchmark
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

## Feature backlog

Highest-value features to add next:

1. PostgreSQL integration test suite and tarball install smoke tests.
2. Generic `batch()` or `pipeline()` facade for grouping pgredis operations.
3. Durable outbox/stream API for applications that currently use Redis Streams.
4. Blocking list pop or explicit queue-first migration guidance for worker pulls.
5. Production metrics for table sizes, cleanup counts, TTL backlog, listener reconnects, and queue lag.
6. Redis-style migration aliases for the most common commands, without claiming protocol compatibility.
7. Framework adapters such as session stores for Express/Fastify/Elysia and cache helpers for common web stacks.
8. More KV options: `set` NX/XX semantics, compare-and-swap, touch/expire helpers, and configurable serialization.

# pgredis

> 🌐 **English | [中文](#中文)**

`pgredis` is a PostgreSQL-backed replacement toolkit for projects that want to
remove Redis from a Redis + PostgreSQL architecture. It targets functional
replacement, not Redis protocol or command compatibility.

This repository publishes two packages:

- `@postgresx/noredis`: KV/TTL cache with conditional writes, collections, counters,
  advisory locks, rate limiting, PostgreSQL pub/sub helpers, durable outbox/stream,
  Redis-style migration aliases, web adapters, production metrics, and a thin
  `pg-boss` queue wrapper.
- `@postgresx/bun-listen`: a Bun-native PostgreSQL `LISTEN/NOTIFY` client using
  `Bun.connect()`. It is a subpackage and can be installed independently.

Runtime adapters:

- Bun: use `Bun.SQL` through `@postgresx/noredis/adapters/bun`, and use
  `@postgresx/bun-listen` for low-level realtime notifications.
- Node.js: use the `pg` package through `@postgresx/noredis/adapters/node`.
- Redis-client-shaped migration facades: use
  `@postgresx/noredis/adapters/ioredis` or `@postgresx/noredis/adapters/redis`
  when existing code expects high-frequency `ioredis` or node-redis method
  names. These are whitelisted facades over `PgredisClient`, not Redis TCP
  clients. Thin package aliases are also available as
  `@postgresx/noredis-ioredis` and `@postgresx/noredis-redis`.

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
await redis.cache.set("session:abc", { userId: 2 }, { nx: true });
const session = await redis.cache.get<{ userId: number }>("session:abc");
await redis.pipeline().set("cache:warm", true).get("cache:warm").exec();
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

Durable outbox/stream and migration aliases:

```ts
const id = await redis.outbox.append("billing.events", { invoiceId: "inv_1" });
const messages = await redis.outbox.claim("billing.events", "worker-a");
await redis.outbox.ack(messages.map((message) => message.id));

await redis.redis.set("session:abc", { userId: 1 }, { PX: 60_000, NX: true });
await redis.redis.blpop("worker:list", 5);
await redis.metrics();
```

## Development

```bash
bun install
bun run build
bun test packages/
bun run check
```

## Benchmark

Benchmarks compare the same operation groups across Node.js + Redis,
Node.js + PostgreSQL, and Bun.js + PostgreSQL on the same GitHub Actions
runner. Run locally with:

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/pgredis \
REDIS_URL=redis://127.0.0.1:6379 \
bun run benchmark
```

The benchmark writes results to `benchmark.md` and updates the summary below.
The GitHub Actions benchmark workflow runs when benchmark-relevant files change
and can also be dispatched manually; it uploads the generated document as an
artifact.
`ioredis` is installed only in this repository as a benchmark/dev dependency;
it is not a runtime dependency of the published `@postgresx/noredis` package.

<!-- BENCHMARK:START -->
Latest benchmark summary, generated by the GitHub Actions benchmark workflow. Ops/sec is higher-is-better; ratios compare against Node.js + Redis for the same operation. KV read rows use the recommended pgredis L1+PostgreSQL path when an L1 scenario exists; writes and non-cache primitives use the PostgreSQL backend path. See [benchmark.md](./benchmark.md) for L1 hit-rate rows, L2 fallback rows, full timings, and notes.

| Operation | Redis | Redis p50 ms | Node PG | Node PG p50 ms | Node PG/Redis | Bun PG | Bun PG p50 ms | Bun PG/Redis |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| KV write | 27,398.35 | 0.476 | 5,524.63 | 2.28 | 0.2x | 12,983.17 | 1.04 | 0.47x |
| KV write (batch) | 141,330.47 | 1.73 | 41,304.25 | 5.07 | 0.29x | 60,076.97 | 3.99 | 0.43x |
| KV read | 39,903.69 | 0.384 | 8,367.31 | 1.68 | 0.21x | 17,620.89 | 0.782 | 0.44x |
| KV read (batch) | 271,394.98 | 0.770 | 94,934.82 | 2.19 | 0.35x | 134,125.41 | 1.32 | 0.49x |
| KV read (hot cache) L1 | 37,602.19 | 0.415 | 901,104.66 | 0.016 | 23.96x | 619,447.43 | 0.021 | 16.47x |
| KV read (99% L1) L1 | 42,460.93 | 0.357 | 477,782.63 | 0.007 | 11.25x | 434,269.23 | 0.008 | 10.23x |
| KV read (95% L1) L1 | 40,009.74 | 0.384 | 214,798.36 | 0.001 | 5.37x | 256,005.83 | 0.001 | 6.4x |
| KV read (90% L1) L1 | 35,894.88 | 0.372 | 183,818.19 | 0.001 | 5.12x | 236,572.39 | 0.001 | 6.59x |
| Counter increment | 43,657.29 | 0.345 | 9,250.29 | 1.57 | 0.21x | 14,680.9 | 0.923 | 0.34x |
| Set add | 46,257.37 | 0.322 | 4,088.86 | 2.55 | 0.09x | 6,259.36 | 1.70 | 0.14x |
| Pub/Sub publish | 48,886.72 | 0.324 | 12,997.21 | 1.16 | 0.27x | 17,574.34 | 0.805 | 0.36x |
<!-- BENCHMARK:END -->

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
| Documentation parity | Partial | The package README has deeper feature coverage than this repository README. | Keep root and package README aligned for Redis replacement boundaries and migration guidance. |
| Monorepo release chain | Guarded in CI | Source package manifests must keep internal packages as `workspace:*`; publish rewrites them to concrete versions in a temp tree. | CI runs `check:workspace-deps` before install, and `publish:packages` remains the only npm publish path. |
| Release credentials | Guarded in workflows | Release Please and npm publish depend on repository secrets and npm provenance setup. | Workflows fail early when `RELEASE_PAT` or `NPM_TOKEN` is missing; still verify package access before the first release. |
| Runtime operations | Documented | Cleanup, table growth, queue lag, and listener health are app-operational concerns. | See `docs/production-runbook.md` for cleanup, bloat checks, listener health, queue monitoring, and rollback guidance. |

The project is suitable for an early beta once CI passes and the benchmark
baseline remains refreshable. It should not be described as a drop-in Redis or
ioredis replacement.

## ioredis comparison

`ioredis` is a Redis protocol client. `pgredis` is a PostgreSQL-native toolkit
that replaces common Redis-backed application primitives without speaking the
Redis protocol or supporting every Redis command.

| Capability | ioredis | pgredis | Launch implication |
| --- | --- | --- | --- |
| Protocol and command surface | Sends Redis commands and supports arbitrary Redis command methods. | Exposes typed PostgreSQL-backed primitives plus whitelisted ioredis/node-redis-shaped facades. | Migration still requires code changes. Redis wire protocol compatibility is intentionally out of scope. |
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

## Migration feature status

All originally planned high-value Redis migration features have first-pass APIs and tests:

1. ~~PostgreSQL integration tests and tarball install smoke tests~~ — CI runs `test:integration` and `smoke:pack`.
2. ~~`batch()` and `pipeline()` grouping facade~~ — `batch()` uses SQL transactions; `pipeline()` executes ordered operations; `multi()` alias included.
3. ~~Durable outbox/stream API~~ — `PgOutboxStream` with `append`, `claim`, `ack` for event-log migrations.
4. ~~Polling `blpop()` / `brpop()` list helpers~~ — Plus `pg-boss` queue adapter for real job queues.
5. ~~Production metrics~~ — `health()`, `stats()`, `metrics()` expose table sizes, cleanup counts, TTL backlog, listener and queue state.
6. ~~Redis-style aliases~~ — `pg.redis.*` covers KV, hash, list, set, sorted set, pub/sub, counters, scan, TTL, and connection lifecycle.
7. ~~Framework-neutral web adapters~~ — Session stores and cache helpers under `@postgresx/noredis/adapters/web`.
8. ~~KV conditional writes~~ — `NX`/`XX`, compare-and-swap, `touch`, `expire`, `persist`, pluggable serialization, and optional L1 cache.
9. ~~ioredis and node-redis facades~~ — `@postgresx/noredis/adapters/ioredis` and `@postgresx/noredis/adapters/redis` with whitelisted method surfaces.
10. ~~Sub-module entry points~~ — `kv`, `hash`, `set`, `sorted-set`, `list`, `pubsub` subpath exports for typed primitives.

See `docs/redis-migration-examples.md` for Redis Streams consumer-group
migration guidance, session-store examples, SQL retry boundaries, benchmark
follow-ups, and explicit non-goals.

---

## 中文

> 🌐 [English](#pgredis) | **中文**

`pgredis` 是一个基于 PostgreSQL 的工具包，旨在帮助项目从 Redis + PostgreSQL 架构中移除 Redis。它专注于功能替代，而非 Redis 协议或命令兼容性。

此仓库发布两个包：

- `@postgresx/noredis`: KV/TTL 缓存、集合操作、计数器、咨询锁、限流、
  PostgreSQL pub/sub 辅助函数，以及轻量的 `pg-boss` 队列包装器。
- `@postgresx/bun-listen`: 使用 `Bun.connect()` 的 Bun 原生 PostgreSQL `LISTEN/NOTIFY` 客户端。
  作为子包，可独立安装使用。

运行时适配器：

- Bun: 通过 `@postgresx/noredis/adapters/bun` 使用 `Bun.SQL`，并使用
  `@postgresx/bun-listen` 进行底层实时通知。
- Node.js: 通过 `@postgresx/noredis/adapters/node` 使用 `pg` 包。
- Redis client 形状的迁移外观：当现有代码需要高频 `ioredis` 或 node-redis
  方法名时，使用 `@postgresx/noredis/adapters/ioredis` 或
  `@postgresx/noredis/adapters/redis`。这些是 `PgredisClient` 之上的白名单外观，
  不是 Redis TCP 客户端。薄 package alias 也可使用
  `@postgresx/noredis-ioredis` 和 `@postgresx/noredis-redis`。

已发布的 `@postgresx/noredis` 包不会自动安装 `pg`、`pg-boss`、Redis 客户端
或 `@postgresx/bun-listen`。请仅安装你使用的功能所需的依赖。

## 安装

`@postgresx/noredis` 没有必需的运行时依赖。请仅为你使用的运行时功能安装数据库驱动或实时包。

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
const redis = createPgredis({ sql, namespace: "app" });

await redis.ensureSchema();
await redis.cache.set("session:abc", { userId: 1 }, { ttlMs: 60_000 });
const session = await redis.cache.get<{ userId: number }>("session:abc");
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

await publishPgNotify(sql, "cache_invalidate", { key: "session:abc" });
listener.close();
```

仅使用 Bun 实时子包：

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
const redis = createPgredis({ sql, namespace: "app" });

await redis.ensureSchema();
await redis.counter.incr("daily:requests");
await sql.close();
```

Node.js `LISTEN/NOTIFY`：

```ts
import { createPgNodeListener } from "@postgresx/noredis/adapters/node";

const listener = createPgNodeListener(process.env.DATABASE_URL!, {
  channels: ["events"],
  onNotify(channel, payload) {
    console.log(channel, payload);
  }
});
```

使用 `pg-boss` 的队列：

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

## 开发

```bash
bun install
bun run build
bun test packages/
bun run check
```

## 基准测试

基准测试在同一 GitHub Actions runner 上比较 Node.js + Redis、
Node.js + PostgreSQL 和 Bun.js + PostgreSQL 的相同操作组。本地运行：

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/pgredis \
REDIS_URL=redis://127.0.0.1:6379 \
bun run benchmark
```

基准测试结果写入 `benchmark.md`，并自动更新英文 Benchmark 部分中的摘要。
GitHub Actions 基准测试工作流会在 benchmark 相关文件变化时运行，也可以手动触发；
生成的文档会作为 artifact 上传。
`ioredis` 仅作为基准测试/开发依赖安装在此仓库中；它不是已发布的
`@postgresx/noredis` 包的运行时依赖。

## 发布准备状态

当前本地验证：

- `@postgresx/bun-listen` 和 `@postgresx/noredis` 的 `bun run build` 通过。
- `bun test packages/` 通过包测试套件。
- `bun run check` 通过 TypeScript 检查。

生产环境或 1.0 发布前的剩余检查项：

| 领域 | 状态 | 重要性 | 建议操作 |
| --- | --- | --- | --- |
| 真实数据库覆盖 | CI 中已添加 | PostgreSQL DDL、索引、事务、JSONB 行为和 LISTEN/NOTIFY 重连行为需要真实数据库覆盖。 | CI 针对 PostgreSQL 16 运行 `bun run test:integration`。调试时使用 `TEST_DATABASE_URL` 本地运行。 |
| 基准测试基线 | 已生成 | `benchmark.md` 已由 GitHub Actions 生成，并区分主对比表和 L1 热读说明。 | benchmark 相关文件变化会自动刷新；本地基准测试运行是可选的。 |
| 安装冒烟测试 | CI 中已添加 | 构建输出存在，但已发布包的形状应从打包的 tarball 验证，包括子路径导出。 | CI 运行 `bun run smoke:pack` 从干净的 Node 和 Bun 入口点导入打包的 tarball。 |
| 文档一致性 | 部分完成 | 包 README 比此仓库 README 有更深的功能覆盖。 | 保持根目录和包 README 对齐，用于 Redis 替换边界和迁移指南。 |
| Monorepo 发布链 | CI 保护 | 源码包清单中的内部包依赖必须保持 `workspace:*`；发布脚本在临时目录改写成具体版本。 | CI 在 install 前运行 `check:workspace-deps`；npm 发布只走 `publish:packages`。 |
| 发布凭证 | 在工作流中保护 | Release Please 和 npm publish 依赖仓库密钥和 npm provenance 设置。 | 当 `RELEASE_PAT` 或 `NPM_TOKEN` 缺失时，工作流会提前失败；首次发布前仍需验证包访问权限。 |
| 运行时操作 | 已文档化 | 清理、表增长、队列延迟和监听器健康是应用操作关注点。 | 请参阅 `docs/production-runbook.md` 了解清理、膨胀检查、监听器健康、队列监控和回滚指南。 |

项目在 CI 通过且 benchmark 基线保持可刷新后适合早期测试版。不应将其描述为 Redis 或 ioredis 的即插即用替代品。

## ioredis 对比

`ioredis` 是 Redis 协议客户端。`pgredis` 是 PostgreSQL 原生工具包，
在不使用 Redis 协议或支持每个 Redis 命令的情况下替换常见的 Redis 支持的应用原语。

| 能力 | ioredis | pgredis | 发布影响 |
| --- | --- | --- | --- |
| 协议和命令表面 | 发送 Redis 命令并支持任意 Redis 命令方法。 | 公开类型化 PostgreSQL 原语，并提供白名单内的 ioredis/node-redis 形状外观。 | 迁移仍需要代码更改。Redis wire protocol 兼容性有意不在范围内。 |
| 运行时依赖 | 需要 Redis、Redis 兼容服务或 Redis Cluster/Sentinel。 | 需要 PostgreSQL；仅为选定功能可选安装 `pg`、`pg-boss` 或 `@postgresx/bun-listen`。 | 适合希望移除独立 Redis 层的团队。 |
| 字符串 / KV / TTL | 完整的 Redis 字符串命令表面。 | JSONB KV 缓存，支持 TTL、批量 get/set、前缀清除、可选本地 L1 缓存和通知失效。 | 覆盖缓存/会话样式的值，但不支持字节字符串命令如 `APPEND`、`GETRANGE` 或 `SETRANGE`。 |
| 哈希、列表、集合、有序集合 | 原生 Redis 数据结构和命令覆盖。 | PostgreSQL 表支持的常见 hash/list/set/zset 操作辅助函数。 | 覆盖常见应用用法；高级/阻塞/列表突变和完整命令对等性不完整。 |
| Pub/Sub | Redis Pub/Sub、模式订阅、二进制消息、集群行为。 | PostgreSQL `LISTEN/NOTIFY` 发布者和 Node/Bun 监听器。 | 适用于轻量级失效/事件；不持久且受 PostgreSQL NOTIFY 有效负载大小限制。 |
| 流 / 消费者组 | Redis Streams 命令如 `XADD` 和消费者组。 | 持久化 outbox/stream 辅助函数加 `pg-boss` 队列适配器。 | 无 Redis consumer-group 协议或 pending-entry-list 兼容。 |
| 管道 / 事务 | `pipeline`、`multi`、`exec` 和集群感知行为。 | `batch()` 使用 SQL 适配器事务；`pipeline()` 执行有序 pgredis 操作。 | 无 Redis wire-level 管道或 `WATCH` 语义。 |
| Lua 脚本 / Redis Functions | 支持脚本命令和自定义命令定义。 | 不在范围内；使用 SQL、存储过程或应用代码。 | 不要直接移植 Lua；重写为 SQL/应用逻辑。 |
| 集群 / Sentinel / NAT 映射 | 内置在 ioredis 中。 | 继承自 PostgreSQL HA、池化和网络。 | 记录 PostgreSQL 部署假设而非 Redis HA 选项。 |
| TLS / ACL / 认证 | Redis 连接、TLS 和 ACL 选项。 | 委托给 PostgreSQL 驱动、DSN 和数据库角色。 | 使用 PostgreSQL 凭据和传输设置。 |
| Redis Stack 模块 | 可以发送模块命令，取决于 Redis 服务器支持。 | 无 RedisJSON、RediSearch、RedisTimeSeries、RedisBloom 外观。 | 首选 PostgreSQL JSONB、全文搜索、pgvector、PostGIS 或扩展。 |
| 离线队列 / 重连策略 | 客户端级离线队列、重试、就绪检查、自动重新订阅。 | Node/Bun 监听器包括重连和健康状态；SQL 操作取决于数据库适配器/池行为。 | 添加操作级重试指南和适配器冒烟测试。 |

## 已完成的迁移功能

所有最初规划的高价值 Redis 迁移功能已有第一版 API 和测试：

1. ~~PostgreSQL 集成测试和 tarball 安装冒烟测试~~ — CI 运行 `test:integration` 和 `smoke:pack`。
2. ~~`batch()` 和 `pipeline()` 分组外观~~ — `batch()` 使用 SQL 事务；`pipeline()` 执行有序操作；包含 `multi()` 别名。
3. ~~持久化 outbox/stream API~~ — `PgOutboxStream` 提供 `append`、`claim`、`ack`，用于事件日志迁移。
4. ~~轮询式 `blpop()` / `brpop()` 列表辅助函数~~ — 加上 `pg-boss` 队列适配器用于真实作业队列。
5. ~~生产指标~~ — `health()`、`stats()`、`metrics()` 暴露表大小、清理计数、TTL 积压、监听器和队列状态。
6. ~~Redis 风格别名~~ — `pg.redis.*` 覆盖 KV、哈希、列表、集合、有序集合、pub/sub、计数器、扫描、TTL 和连接生命周期。
7. ~~框架中立 Web 适配器~~ — `@postgresx/noredis/adapters/web` 下的会话存储和缓存辅助函数。
8. ~~KV 条件写入~~ — `NX`/`XX`、比较并交换、`touch`、`expire`、`persist`、可插拔序列化和可选 L1 缓存。
9. ~~ioredis 和 node-redis 外观~~ — `@postgresx/noredis/adapters/ioredis` 和 `@postgresx/noredis/adapters/redis`，带白名单方法表面。
10. ~~子模块入口~~ — `kv`、`hash`、`set`、`sorted-set`、`list`、`pubsub` 子路径导出类型化原语。

更多迁移材料见 `docs/redis-migration-examples.md`：Redis Streams consumer-group
迁移、session store 示例、SQL 重试边界、benchmark 后续项和明确非目标。

# pgredis

> 🌐 **English | [中文](#中文)**

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

基准测试在同一 GitHub Actions runner 上比较 Redis 和 PostgreSQL 的相同操作组。本地运行：

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/pgredis \
REDIS_URL=redis://127.0.0.1:6379 \
bun run benchmark
```

基准测试结果写入 `benchmark.md`。GitHub Actions 基准测试工作流是手动触发的，
并将生成的文档作为 artifact 上传。`ioredis` 仅作为基准测试/开发依赖安装在此仓库中；
它不是已发布的 `@postgresx/noredis` 包的运行时依赖。

## 发布准备状态

当前本地验证：

- `@postgresx/bun-listen` 和 `@postgresx/noredis` 的 `bun run build` 通过。
- `bun test packages/` 通过包测试套件。
- `bun run check` 通过 TypeScript 检查。

生产环境或 1.0 发布前的剩余检查项：

| 领域 | 状态 | 重要性 | 建议操作 |
| --- | --- | --- | --- |
| 真实数据库覆盖 | CI 中已添加 | PostgreSQL DDL、索引、事务、JSONB 行为和 LISTEN/NOTIFY 重连行为需要真实数据库覆盖。 | CI 针对 PostgreSQL 16 运行 `bun run test:integration`。调试时使用 `TEST_DATABASE_URL` 本地运行。 |
| 基准测试基线 | 等待 CI 运行 | `benchmark.md` 尚未生成，因此没有测量的 Redis 与 PostgreSQL 基线来设定用户期望。 | 发布前运行手动基准测试工作流；本地基准测试运行是可选的。 |
| 安装冒烟测试 | CI 中已添加 | 构建输出存在，但已发布包的形状应从打包的 tarball 验证，包括子路径导出。 | CI 运行 `bun run smoke:pack` 从干净的 Node 和 Bun 入口点导入打包的 tarball。 |
| 文档一致性 | 部分完成 | 包 README 比此仓库 README 有更深的功能覆盖。 | 保持根目录和包 README 对齐，用于 Redis 替换边界和迁移指南。 |
| 发布凭证 | 在工作流中保护 | Release Please 和 npm publish 依赖仓库密钥和 npm provenance 设置。 | 当 `RELEASE_PAT` 或 `NPM_TOKEN` 缺失时，工作流会提前失败；首次发布前仍需验证包访问权限。 |
| 运行时操作 | 已文档化 | 清理、表增长、队列延迟和监听器健康是应用操作关注点。 | 请参阅 `docs/production-runbook.md` 了解清理、膨胀检查、监听器健康、队列监控和回滚指南。 |

项目在 CI 通过且基准测试工作流生成基线后适合早期测试版。不应将其描述为 Redis 或 ioredis 的即插即用替代品。

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

## 功能待办

下一步要添加的最高价值功能：

1. PostgreSQL 集成测试套件和 tarball 安装冒烟测试。
2. 通用 `batch()` 或 `pipeline()` 外观，用于分组 pgredis 操作。
3. 持久化 outbox/stream API，用于当前使用 Redis Streams 的应用。
4. 阻塞列表弹出或显式队列优先迁移指南，用于工作者拉取。
5. 生产指标，用于表大小、清理计数、TTL 积压、监听器重连和队列延迟。
6. Redis 风格的迁移别名，用于最常见的命令，不声称协议兼容性。
7. 框架适配器，如 Express/Fastify/Elysia 的会话存储和常见 Web 栈的缓存辅助函数。
8. 更多 KV 选项：`set` NX/XX 语义、比较并交换、touch/expire 辅助函数和可配置序列化。
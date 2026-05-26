# Benchmark

Generated at: 2026-05-26T14:57:59.006Z

Iterations per case: 2000
Concurrency per case: 16

Services:

- Redis and PostgreSQL run on the same GitHub Actions runner in the benchmark workflow.
- The benchmark workflow runs PostgreSQL 18 with asynchronous I/O enabled via `io_method=worker`.
- The workflow gives both service containers `--cpus 2 --memory 2g`.
- Node.js tests run with `node`; Bun.js tests run with `bun`.
- Main comparison rows use `@postgresx/noredis` with local L1 disabled, so reads hit PostgreSQL. This compares Redis as a service with PostgreSQL as a service.
- L1 is enabled only for the hot-read note and details rows, because it measures an in-process application cache rather than the PostgreSQL service itself.
- PostgreSQL tables created by pgredis are `UNLOGGED` by default for cache-like workloads, and the workflow sets `synchronous_commit=off` for the benchmark database. Both choices trade crash-time recency guarantees for cache throughput.

## Summary

Ops/sec is higher-is-better. The main table keeps pgredis L1 disabled to avoid mixing service-level backend performance with in-process cache hits.

| Operation | Node.js + Redis ops/sec | Node.js + PostgreSQL ops/sec | Node/Postgres vs Redis | Bun.js + PostgreSQL ops/sec | Bun/Postgres vs Redis |
| --- | ---: | ---: | ---: | ---: | ---: |
| KV write | 34,169.03 | 6,738.85 | 0.2x | 15,836.2 | 0.46x |
| KV write (batch) | 195,351.13 | 44,331.98 | 0.23x | 64,644.69 | 0.33x |
| KV read | 40,023.92 | 9,330.81 | 0.23x | 22,784.09 | 0.57x |
| KV read (batch) | 281,576.6 | 96,363.16 | 0.34x | 161,585.79 | 0.57x |
| KV read (hot cache) | 40,851.48 | 9,895.56 | 0.24x | 27,501.96 | 0.67x |
| Counter increment | 46,903.03 | 9,732.1 | 0.21x | 15,159.77 | 0.32x |
| Set add | 47,387.95 | 4,506.86 | 0.1x | 7,102.06 | 0.15x |
| Pub/Sub publish | 38,994.5 | 13,383.9 | 0.34x | 18,160.5 | 0.47x |

## L1 Hot-Read Note

For the hot-read cache case with pgredis L1 enabled: Node/Postgres L1 reached 1,579,425.77 ops/sec (38.66x vs Redis), and Bun/Postgres L1 reached 645,895.74 ops/sec (15.81x vs Redis).

## Details

| Operation | Backend | Iterations | Concurrency | Duration ms | Ops/sec |
| --- | --- | ---: | ---: | ---: | ---: |
| KV write | Node.js + Redis | 2000 | 16 | 58.53 | 34,169.03 |
| KV write (batch) | Node.js + Redis | 2000 | 16 | 10.24 | 195,351.13 |
| KV read | Node.js + Redis | 2000 | 16 | 49.97 | 40,023.92 |
| KV read (batch) | Node.js + Redis | 2000 | 16 | 7.1 | 281,576.6 |
| KV read (hot cache) | Node.js + Redis | 2000 | 16 | 48.96 | 40,851.48 |
| Counter increment | Node.js + Redis | 2000 | 16 | 42.64 | 46,903.03 |
| Set add | Node.js + Redis | 2000 | 16 | 42.2 | 47,387.95 |
| Pub/Sub publish | Node.js + Redis | 2000 | 16 | 51.29 | 38,994.5 |
| KV write | Node.js + PostgreSQL | 2000 | 16 | 296.79 | 6,738.85 |
| KV write (batch) | Node.js + PostgreSQL | 2000 | 16 | 45.11 | 44,331.98 |
| KV read | Node.js + PostgreSQL | 2000 | 16 | 214.34 | 9,330.81 |
| KV read (batch) | Node.js + PostgreSQL | 2000 | 16 | 20.75 | 96,363.16 |
| KV read (hot cache) | Node.js + PostgreSQL | 2000 | 16 | 202.11 | 9,895.56 |
| Counter increment | Node.js + PostgreSQL | 2000 | 16 | 205.51 | 9,732.1 |
| Set add | Node.js + PostgreSQL | 2000 | 16 | 443.77 | 4,506.86 |
| Pub/Sub publish | Node.js + PostgreSQL | 2000 | 16 | 149.43 | 13,383.9 |
| KV read (hot cache) | Node.js + PostgreSQL (L1) | 2000 | 16 | 1.27 | 1,579,425.77 |
| KV write | Bun.js + PostgreSQL | 2000 | 16 | 126.29 | 15,836.2 |
| KV write (batch) | Bun.js + PostgreSQL | 2000 | 16 | 30.94 | 64,644.69 |
| KV read | Bun.js + PostgreSQL | 2000 | 16 | 87.78 | 22,784.09 |
| KV read (batch) | Bun.js + PostgreSQL | 2000 | 16 | 12.38 | 161,585.79 |
| KV read (hot cache) | Bun.js + PostgreSQL | 2000 | 16 | 72.72 | 27,501.96 |
| Counter increment | Bun.js + PostgreSQL | 2000 | 16 | 131.93 | 15,159.77 |
| Set add | Bun.js + PostgreSQL | 2000 | 16 | 281.61 | 7,102.06 |
| Pub/Sub publish | Bun.js + PostgreSQL | 2000 | 16 | 110.13 | 18,160.5 |
| KV read (hot cache) | Bun.js + PostgreSQL (L1) | 2000 | 16 | 3.1 | 645,895.74 |

Notes:

- Redis tests use key prefixes and do not flush the whole database.
- PostgreSQL tests create temporary benchmark tables and drop them at the end.
- PostgreSQL `(L1)` detail rows are informational only and are intentionally excluded from the main comparison table.
- Numbers are intended for regression tracking, not universal database sizing.

References behind benchmark design:

- PostgreSQL `UNLOGGED` tables reduce WAL work for cache-like data, with crash-safety and replication trade-offs: https://www.postgresql.org/docs/current/sql-createtable.html
- `synchronous_commit=off` can improve throughput for noncritical transactions while risking loss of recent acknowledged commits after a crash: https://www.postgresql.org/docs/current/runtime-config-wal.html
- PostgreSQL pipeline mode reduces client/server round trips by sending multiple queries before reading prior results: https://www.postgresql.org/docs/current/libpq-pipeline-mode.html
- PostgreSQL bulk-loading guidance favors batching, transactions, prepared statements, and COPY over many independent INSERTs: https://www.postgresql.org/docs/current/populate.html

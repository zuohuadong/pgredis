# Benchmark

Generated at: 2026-05-26T23:41:33.794Z

Iterations per case: 2000
Concurrency per case: 16

Services:

- Redis and PostgreSQL run on the same GitHub Actions runner in the benchmark workflow.
- The benchmark workflow runs PostgreSQL 18 with asynchronous I/O enabled via `io_method=worker`.
- The workflow gives both service containers `--cpus 2 --memory 2g`.
- Node.js tests run with `node`; Bun.js tests run with `bun`.
- PostgreSQL columns without `(L1)` use `@postgresx/noredis` with local L1 disabled, so reads hit PostgreSQL. These compare Redis as a service with PostgreSQL as a service.
- PostgreSQL `(L1)` columns enable pgredis in-process memory caching for the hot-read case. That is a valid application-cache mode for Redis replacement, but it measures local process memory plus PostgreSQL backing storage.
- PostgreSQL tables created by pgredis are `UNLOGGED` by default for cache-like workloads, and the workflow sets `synchronous_commit=off` for the benchmark database. Both choices trade crash-time recency guarantees for cache throughput.

## Summary

Ops/sec is higher-is-better. Non-L1 PostgreSQL columns show the service-level backend path; `(L1)` columns show the application hot-read path.

| Operation | Redis | Node PG | Node PG/Redis | Node PG L1 | Node PG L1/Redis | Bun PG | Bun PG/Redis | Bun PG L1 | Bun PG L1/Redis |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| KV write | 29,589.68 | 6,024.44 | 0.2x | - | - | 10,462.59 | 0.35x | - | - |
| KV write (batch) | 197,153.42 | 35,253.36 | 0.18x | - | - | 54,315.9 | 0.28x | - | - |
| KV read | 36,799.54 | 6,516.98 | 0.18x | - | - | 14,727.71 | 0.4x | - | - |
| KV read (batch) | 280,891.03 | 74,379.02 | 0.26x | - | - | 125,259.98 | 0.45x | - | - |
| KV read (hot cache) | 40,545.65 | 6,693.7 | 0.17x | 1,378,698.01 | 34x | 13,834.58 | 0.34x | 627,734.57 | 15.48x |
| Counter increment | 44,612.24 | 6,740.27 | 0.15x | - | - | 10,242.37 | 0.23x | - | - |
| Set add | 46,388.29 | 4,139.44 | 0.09x | - | - | 5,786.01 | 0.12x | - | - |
| Pub/Sub publish | 38,153.57 | 8,663.78 | 0.23x | - | - | 13,766.6 | 0.36x | - | - |

## Details

| Operation | Backend | Iterations | Concurrency | Duration ms | Ops/sec |
| --- | --- | ---: | ---: | ---: | ---: |
| KV write | Node.js + Redis | 2000 | 16 | 67.59 | 29,589.68 |
| KV write (batch) | Node.js + Redis | 2000 | 16 | 10.14 | 197,153.42 |
| KV read | Node.js + Redis | 2000 | 16 | 54.35 | 36,799.54 |
| KV read (batch) | Node.js + Redis | 2000 | 16 | 7.12 | 280,891.03 |
| KV read (hot cache) | Node.js + Redis | 2000 | 16 | 49.33 | 40,545.65 |
| Counter increment | Node.js + Redis | 2000 | 16 | 44.83 | 44,612.24 |
| Set add | Node.js + Redis | 2000 | 16 | 43.11 | 46,388.29 |
| Pub/Sub publish | Node.js + Redis | 2000 | 16 | 52.42 | 38,153.57 |
| KV write | Node.js + PostgreSQL | 2000 | 16 | 331.98 | 6,024.44 |
| KV write (batch) | Node.js + PostgreSQL | 2000 | 16 | 56.73 | 35,253.36 |
| KV read | Node.js + PostgreSQL | 2000 | 16 | 306.89 | 6,516.98 |
| KV read (batch) | Node.js + PostgreSQL | 2000 | 16 | 26.89 | 74,379.02 |
| KV read (hot cache) | Node.js + PostgreSQL | 2000 | 16 | 298.79 | 6,693.7 |
| Counter increment | Node.js + PostgreSQL | 2000 | 16 | 296.72 | 6,740.27 |
| Set add | Node.js + PostgreSQL | 2000 | 16 | 483.16 | 4,139.44 |
| Pub/Sub publish | Node.js + PostgreSQL | 2000 | 16 | 230.85 | 8,663.78 |
| KV read (hot cache) | Node.js + PostgreSQL (L1) | 2000 | 16 | 1.45 | 1,378,698.01 |
| KV write | Bun.js + PostgreSQL | 2000 | 16 | 191.16 | 10,462.59 |
| KV write (batch) | Bun.js + PostgreSQL | 2000 | 16 | 36.82 | 54,315.9 |
| KV read | Bun.js + PostgreSQL | 2000 | 16 | 135.8 | 14,727.71 |
| KV read (batch) | Bun.js + PostgreSQL | 2000 | 16 | 15.97 | 125,259.98 |
| KV read (hot cache) | Bun.js + PostgreSQL | 2000 | 16 | 144.57 | 13,834.58 |
| Counter increment | Bun.js + PostgreSQL | 2000 | 16 | 195.27 | 10,242.37 |
| Set add | Bun.js + PostgreSQL | 2000 | 16 | 345.66 | 5,786.01 |
| Pub/Sub publish | Bun.js + PostgreSQL | 2000 | 16 | 145.28 | 13,766.6 |
| KV read (hot cache) | Bun.js + PostgreSQL (L1) | 2000 | 16 | 3.19 | 627,734.57 |

Notes:

- Redis tests use key prefixes and do not flush the whole database.
- PostgreSQL tests create temporary benchmark tables and drop them at the end.
- Empty `(L1)` cells mean that operation does not use pgredis L1 in the benchmark; L1 is only meaningful for hot cache reads.
- Numbers are intended for regression tracking, not universal database sizing.

References behind benchmark design:

- PostgreSQL `UNLOGGED` tables reduce WAL work for cache-like data, with crash-safety and replication trade-offs: https://www.postgresql.org/docs/current/sql-createtable.html
- `synchronous_commit=off` can improve throughput for noncritical transactions while risking loss of recent acknowledged commits after a crash: https://www.postgresql.org/docs/current/runtime-config-wal.html
- PostgreSQL pipeline mode reduces client/server round trips by sending multiple queries before reading prior results: https://www.postgresql.org/docs/current/libpq-pipeline-mode.html
- PostgreSQL bulk-loading guidance favors batching, transactions, prepared statements, and COPY over many independent INSERTs: https://www.postgresql.org/docs/current/populate.html

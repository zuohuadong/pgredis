# Benchmark

Generated at: 2026-05-26T23:25:21.153Z

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
| KV write | 36,894.77 | 6,640.19 | 0.18x | - | - | 15,284.04 | 0.41x | - | - |
| KV write (batch) | 218,793.1 | 39,898.4 | 0.18x | - | - | 65,942.07 | 0.3x | - | - |
| KV read | 45,201.05 | 9,266.06 | 0.2x | - | - | 21,109.1 | 0.47x | - | - |
| KV read (batch) | 315,835.72 | 97,251.33 | 0.31x | - | - | 137,818.65 | 0.44x | - | - |
| KV read (hot cache) | 49,376.11 | 9,759.8 | 0.2x | 1,468,184.08 | 29.73x | 25,090.59 | 0.51x | 451,117.47 | 9.14x |
| Counter increment | 54,115.78 | 9,464.99 | 0.17x | - | - | 13,430.65 | 0.25x | - | - |
| Set add | 62,980.67 | 4,662.28 | 0.07x | - | - | 7,564.46 | 0.12x | - | - |
| Pub/Sub publish | 46,285.88 | 12,424.22 | 0.27x | - | - | 16,179.5 | 0.35x | - | - |

## Details

| Operation | Backend | Iterations | Concurrency | Duration ms | Ops/sec |
| --- | --- | ---: | ---: | ---: | ---: |
| KV write | Node.js + Redis | 2000 | 16 | 54.21 | 36,894.77 |
| KV write (batch) | Node.js + Redis | 2000 | 16 | 9.14 | 218,793.1 |
| KV read | Node.js + Redis | 2000 | 16 | 44.25 | 45,201.05 |
| KV read (batch) | Node.js + Redis | 2000 | 16 | 6.33 | 315,835.72 |
| KV read (hot cache) | Node.js + Redis | 2000 | 16 | 40.51 | 49,376.11 |
| Counter increment | Node.js + Redis | 2000 | 16 | 36.96 | 54,115.78 |
| Set add | Node.js + Redis | 2000 | 16 | 31.76 | 62,980.67 |
| Pub/Sub publish | Node.js + Redis | 2000 | 16 | 43.21 | 46,285.88 |
| KV write | Node.js + PostgreSQL | 2000 | 16 | 301.2 | 6,640.19 |
| KV write (batch) | Node.js + PostgreSQL | 2000 | 16 | 50.13 | 39,898.4 |
| KV read | Node.js + PostgreSQL | 2000 | 16 | 215.84 | 9,266.06 |
| KV read (batch) | Node.js + PostgreSQL | 2000 | 16 | 20.57 | 97,251.33 |
| KV read (hot cache) | Node.js + PostgreSQL | 2000 | 16 | 204.92 | 9,759.8 |
| Counter increment | Node.js + PostgreSQL | 2000 | 16 | 211.3 | 9,464.99 |
| Set add | Node.js + PostgreSQL | 2000 | 16 | 428.97 | 4,662.28 |
| Pub/Sub publish | Node.js + PostgreSQL | 2000 | 16 | 160.98 | 12,424.22 |
| KV read (hot cache) | Node.js + PostgreSQL (L1) | 2000 | 16 | 1.36 | 1,468,184.08 |
| KV write | Bun.js + PostgreSQL | 2000 | 16 | 130.86 | 15,284.04 |
| KV write (batch) | Bun.js + PostgreSQL | 2000 | 16 | 30.33 | 65,942.07 |
| KV read | Bun.js + PostgreSQL | 2000 | 16 | 94.75 | 21,109.1 |
| KV read (batch) | Bun.js + PostgreSQL | 2000 | 16 | 14.51 | 137,818.65 |
| KV read (hot cache) | Bun.js + PostgreSQL | 2000 | 16 | 79.71 | 25,090.59 |
| Counter increment | Bun.js + PostgreSQL | 2000 | 16 | 148.91 | 13,430.65 |
| Set add | Bun.js + PostgreSQL | 2000 | 16 | 264.39 | 7,564.46 |
| Pub/Sub publish | Bun.js + PostgreSQL | 2000 | 16 | 123.61 | 16,179.5 |
| KV read (hot cache) | Bun.js + PostgreSQL (L1) | 2000 | 16 | 4.43 | 451,117.47 |

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

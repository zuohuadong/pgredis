# Benchmark

Generated at: 2026-05-27T07:46:14.950Z

Iterations per case: 2000
Concurrency per case: 16

Services:

- Redis and PostgreSQL run on the same GitHub Actions runner in the benchmark workflow.
- The benchmark workflow runs PostgreSQL 18 with asynchronous I/O enabled via `io_method=worker`.
- The workflow gives both service containers `--cpus 2 --memory 2g`.
- Node.js tests run with `node`; Bun.js tests run with `bun`.
- Node.js PostgreSQL uses a connection pool sized to the benchmark concurrency.
- The recommended cache replacement path is L1 in-process memory backed by PostgreSQL L2 storage. L1 rows show that path; L2 rows show the direct PostgreSQL fallback/backend path.
- The 99%, 95%, and 90% L1 rows intentionally mix local hits with PostgreSQL misses to model realistic cache-aside workloads.
- PostgreSQL tables created by pgredis are `UNLOGGED` by default for cache-like workloads, and the workflow sets `synchronous_commit=off` for the benchmark database. Both choices trade crash-time recency guarantees for cache throughput.

## Application Cache Path

Ops/sec is higher-is-better. This table follows the recommended Redis replacement shape: KV reads use L1 when a matching L1 scenario exists; writes and non-cache primitives use the PostgreSQL backend path.

| Operation | Redis | Redis p50 ms | Node PG | Node PG p50 ms | Node PG/Redis | Bun PG | Bun PG p50 ms | Bun PG/Redis |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| KV write | 34,718.85 | 0.391 | 6,562.78 | 1.96 | 0.19x | 16,267.84 | 0.798 | 0.47x |
| KV write (batch) | 154,479.21 | 1.54 | 45,048.19 | 5.08 | 0.29x | 69,503.86 | 3.29 | 0.45x |
| KV read | 47,375.44 | 0.316 | 9,520.44 | 1.46 | 0.2x | 22,330.15 | 0.597 | 0.47x |
| KV read (batch) | 308,714.68 | 0.646 | 93,867.18 | 2.43 | 0.3x | 132,888.76 | 1.60 | 0.43x |
| KV read (hot cache) L1 | 46,362.77 | 0.318 | 1,354,234.59 | 0.010 | 29.21x | 628,915.39 | 0.023 | 13.57x |
| KV read (99% L1) L1 | 48,863.62 | 0.300 | 632,284.71 | 0.003 | 12.94x | 478,315.34 | 0.008 | 9.79x |
| KV read (95% L1) L1 | 48,732.96 | 0.316 | 222,466.89 | 0.001 | 4.57x | 277,014.56 | 0.001 | 5.68x |
| KV read (90% L1) L1 | 44,075.21 | 0.301 | 205,952.65 | 0.001 | 4.67x | 288,005.04 | 0.001 | 6.53x |
| Counter increment | 46,463.34 | 0.325 | 10,892.08 | 1.27 | 0.23x | 13,002.05 | 1.01 | 0.28x |
| Set add | 53,482.01 | 0.274 | 4,362.8 | 2.28 | 0.08x | 6,744.97 | 1.67 | 0.13x |
| Pub/Sub publish | 58,494.35 | 0.266 | 16,969.88 | 0.874 | 0.29x | 20,850.03 | 0.680 | 0.36x |

## L1 Read Cache

These rows isolate pgredis local memory cache behavior. Mixed hit-rate rows include PostgreSQL misses and are closer to real cache-aside usage than the 100% hot-cache row.

| Operation | Redis | Redis p50 ms | Node PG L1 | Node PG L1 p50 ms | Node PG L1/Redis | Bun PG L1 | Bun PG L1 p50 ms | Bun PG L1/Redis |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| KV read (hot cache) | 46,362.77 | 0.318 | 1,354,234.59 | 0.010 | 29.21x | 628,915.39 | 0.023 | 13.57x |
| KV read (99% L1) | 48,863.62 | 0.300 | 632,284.71 | 0.003 | 12.94x | 478,315.34 | 0.008 | 9.79x |
| KV read (95% L1) | 48,732.96 | 0.316 | 222,466.89 | 0.001 | 4.57x | 277,014.56 | 0.001 | 5.68x |
| KV read (90% L1) | 44,075.21 | 0.301 | 205,952.65 | 0.001 | 4.67x | 288,005.04 | 0.001 | 6.53x |

## L2 Backend Path

These rows disable pgredis L1 and measure direct PostgreSQL access. They are useful for fallback sizing and regression tracking, not as the main cache-hit comparison.

| Operation | Redis | Redis p50 ms | Node PG L2 | Node PG L2 p50 ms | Node PG L2/Redis | Bun PG L2 | Bun PG L2 p50 ms | Bun PG L2/Redis |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| KV write | 34,718.85 | 0.391 | 6,562.78 | 1.96 | 0.19x | 16,267.84 | 0.798 | 0.47x |
| KV write (batch) | 154,479.21 | 1.54 | 45,048.19 | 5.08 | 0.29x | 69,503.86 | 3.29 | 0.45x |
| KV read | 47,375.44 | 0.316 | 9,520.44 | 1.46 | 0.2x | 22,330.15 | 0.597 | 0.47x |
| KV read (batch) | 308,714.68 | 0.646 | 93,867.18 | 2.43 | 0.3x | 132,888.76 | 1.60 | 0.43x |
| KV read (hot cache) | 46,362.77 | 0.318 | 10,684.06 | 1.36 | 0.23x | 25,640.21 | 0.530 | 0.55x |
| KV read (99% L1) | 48,863.62 | 0.300 | 10,768.7 | 1.32 | 0.22x | 25,198.8 | 0.563 | 0.52x |
| KV read (95% L1) | 48,732.96 | 0.316 | 10,895.16 | 1.31 | 0.22x | 23,905.94 | 0.579 | 0.49x |
| KV read (90% L1) | 44,075.21 | 0.301 | 10,411.66 | 1.36 | 0.24x | 24,436.03 | 0.585 | 0.55x |
| Counter increment | 46,463.34 | 0.325 | 10,892.08 | 1.27 | 0.23x | 13,002.05 | 1.01 | 0.28x |
| Set add | 53,482.01 | 0.274 | 4,362.8 | 2.28 | 0.08x | 6,744.97 | 1.67 | 0.13x |
| Pub/Sub publish | 58,494.35 | 0.266 | 16,969.88 | 0.874 | 0.29x | 20,850.03 | 0.680 | 0.36x |

## Details

| Operation | Backend | Iterations | Concurrency | Duration ms | Ops/sec | Avg ms | p50 ms | p99 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| KV write | Node.js + Redis | 2000 | 16 | 57.61 | 34,718.85 | 0.454 | 0.391 | 1.47 |
| KV write (batch) | Node.js + Redis | 2000 | 16 | 12.95 | 154,479.21 | 1.52 | 1.54 | 2.34 |
| KV read | Node.js + Redis | 2000 | 16 | 42.22 | 47,375.44 | 0.335 | 0.316 | 0.713 |
| KV read (batch) | Node.js + Redis | 2000 | 16 | 6.48 | 308,714.68 | 0.770 | 0.646 | 2.02 |
| KV read (hot cache) | Node.js + Redis | 2000 | 16 | 43.14 | 46,362.77 | 0.343 | 0.318 | 0.960 |
| KV read (99% L1) | Node.js + Redis | 2000 | 16 | 40.93 | 48,863.62 | 0.325 | 0.300 | 1.09 |
| KV read (95% L1) | Node.js + Redis | 2000 | 16 | 41.04 | 48,732.96 | 0.326 | 0.316 | 0.508 |
| KV read (90% L1) | Node.js + Redis | 2000 | 16 | 45.38 | 44,075.21 | 0.361 | 0.301 | 1.20 |
| Counter increment | Node.js + Redis | 2000 | 16 | 43.04 | 46,463.34 | 0.340 | 0.325 | 0.841 |
| Set add | Node.js + Redis | 2000 | 16 | 37.4 | 53,482.01 | 0.296 | 0.274 | 0.475 |
| Pub/Sub publish | Node.js + Redis | 2000 | 16 | 34.19 | 58,494.35 | 0.271 | 0.266 | 0.402 |
| KV write | Node.js + PostgreSQL | 2000 | 16 | 304.75 | 6,562.78 | 2.43 | 1.96 | 7.52 |
| KV write (batch) | Node.js + PostgreSQL | 2000 | 16 | 44.4 | 45,048.19 | 5.47 | 5.08 | 12.15 |
| KV read | Node.js + PostgreSQL | 2000 | 16 | 210.07 | 9,520.44 | 1.68 | 1.46 | 3.87 |
| KV read (batch) | Node.js + PostgreSQL | 2000 | 16 | 21.31 | 93,867.18 | 2.64 | 2.43 | 5.06 |
| KV read (hot cache) | Node.js + PostgreSQL | 2000 | 16 | 187.19 | 10,684.06 | 1.50 | 1.36 | 3.04 |
| KV read (99% L1) | Node.js + PostgreSQL | 2000 | 16 | 185.72 | 10,768.7 | 1.48 | 1.32 | 3.21 |
| KV read (95% L1) | Node.js + PostgreSQL | 2000 | 16 | 183.57 | 10,895.16 | 1.47 | 1.31 | 3.66 |
| KV read (90% L1) | Node.js + PostgreSQL | 2000 | 16 | 192.09 | 10,411.66 | 1.53 | 1.36 | 4.52 |
| Counter increment | Node.js + PostgreSQL | 2000 | 16 | 183.62 | 10,892.08 | 1.46 | 1.27 | 4.41 |
| Set add | Node.js + PostgreSQL | 2000 | 16 | 458.42 | 4,362.8 | 3.66 | 2.28 | 36.70 |
| Pub/Sub publish | Node.js + PostgreSQL | 2000 | 16 | 117.86 | 16,969.88 | 0.939 | 0.874 | 2.14 |
| KV read (hot cache) | Node.js + PostgreSQL (L1) | 2000 | 16 | 1.48 | 1,354,234.59 | 0.011 | 0.010 | 0.038 |
| KV read (99% L1) | Node.js + PostgreSQL (L1) | 2000 | 16 | 3.16 | 632,284.71 | 0.023 | 0.003 | 0.520 |
| KV read (95% L1) | Node.js + PostgreSQL (L1) | 2000 | 16 | 8.99 | 222,466.89 | 0.069 | 0.001 | 1.94 |
| KV read (90% L1) | Node.js + PostgreSQL (L1) | 2000 | 16 | 9.71 | 205,952.65 | 0.077 | 0.001 | 2.16 |
| KV write | Bun.js + PostgreSQL | 2000 | 16 | 122.94 | 16,267.84 | 0.977 | 0.798 | 4.14 |
| KV write (batch) | Bun.js + PostgreSQL | 2000 | 16 | 28.78 | 69,503.86 | 3.45 | 3.29 | 7.72 |
| KV read | Bun.js + PostgreSQL | 2000 | 16 | 89.56 | 22,330.15 | 0.713 | 0.597 | 2.52 |
| KV read (batch) | Bun.js + PostgreSQL | 2000 | 16 | 15.05 | 132,888.76 | 1.83 | 1.60 | 6.02 |
| KV read (hot cache) | Bun.js + PostgreSQL | 2000 | 16 | 78 | 25,640.21 | 0.619 | 0.530 | 1.83 |
| KV read (99% L1) | Bun.js + PostgreSQL | 2000 | 16 | 79.37 | 25,198.8 | 0.630 | 0.563 | 1.79 |
| KV read (95% L1) | Bun.js + PostgreSQL | 2000 | 16 | 83.66 | 23,905.94 | 0.668 | 0.579 | 1.97 |
| KV read (90% L1) | Bun.js + PostgreSQL | 2000 | 16 | 81.85 | 24,436.03 | 0.654 | 0.585 | 1.68 |
| Counter increment | Bun.js + PostgreSQL | 2000 | 16 | 153.82 | 13,002.05 | 1.22 | 1.01 | 3.85 |
| Set add | Bun.js + PostgreSQL | 2000 | 16 | 296.52 | 6,744.97 | 2.36 | 1.67 | 14.01 |
| Pub/Sub publish | Bun.js + PostgreSQL | 2000 | 16 | 95.92 | 20,850.03 | 0.764 | 0.680 | 2.17 |
| KV read (hot cache) | Bun.js + PostgreSQL (L1) | 2000 | 16 | 3.18 | 628,915.39 | 0.024 | 0.023 | 0.068 |
| KV read (99% L1) | Bun.js + PostgreSQL (L1) | 2000 | 16 | 4.18 | 478,315.34 | 0.032 | 0.008 | 0.225 |
| KV read (95% L1) | Bun.js + PostgreSQL (L1) | 2000 | 16 | 7.22 | 277,014.56 | 0.057 | 0.001 | 1.57 |
| KV read (90% L1) | Bun.js + PostgreSQL (L1) | 2000 | 16 | 6.94 | 288,005.04 | 0.054 | 0.001 | 1.24 |

Notes:

- Redis tests use key prefixes and do not flush the whole database.
- PostgreSQL tests create temporary benchmark tables and drop them at the end.
- L1 applies only to KV reads. Counter, set, and pub/sub rows are functional replacement paths over PostgreSQL, not local-cache shortcuts.
- Numbers are intended for regression tracking, not universal database sizing.

References behind benchmark design:

- PostgreSQL `UNLOGGED` tables reduce WAL work for cache-like data, with crash-safety and replication trade-offs: https://www.postgresql.org/docs/current/sql-createtable.html
- `synchronous_commit=off` can improve throughput for noncritical transactions while risking loss of recent acknowledged commits after a crash: https://www.postgresql.org/docs/current/runtime-config-wal.html
- PostgreSQL pipeline mode reduces client/server round trips by sending multiple queries before reading prior results: https://www.postgresql.org/docs/current/libpq-pipeline-mode.html
- PostgreSQL bulk-loading guidance favors batching, transactions, prepared statements, and COPY over many independent INSERTs: https://www.postgresql.org/docs/current/populate.html

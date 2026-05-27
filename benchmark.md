# Benchmark

Generated at: 2026-05-27T08:57:27.955Z

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
| KV write | 29,347.81 | 0.471 | 6,034.33 | 1.89 | 0.21x | 13,662.3 | 0.974 | 0.47x |
| KV write (batch) | 156,679.9 | 1.38 | 43,795.39 | 5.57 | 0.28x | 62,552.95 | 3.83 | 0.4x |
| KV read | 39,554.14 | 0.390 | 8,292.8 | 1.63 | 0.21x | 18,437.81 | 0.779 | 0.47x |
| KV read (batch) | 312,171.63 | 0.776 | 91,899.09 | 2.23 | 0.29x | 129,904.98 | 1.55 | 0.42x |
| KV read (hot cache) L1 | 39,507.49 | 0.383 | 1,222,041.22 | 0.011 | 30.93x | 568,568.19 | 0.023 | 14.39x |
| KV read (99% L1) L1 | 43,745.82 | 0.348 | 659,019.41 | 0.003 | 15.06x | 427,833.29 | 0.008 | 9.78x |
| KV read (95% L1) L1 | 41,929.54 | 0.381 | 208,880.75 | 0.001 | 4.98x | 287,050.84 | 0.002 | 6.85x |
| KV read (90% L1) L1 | 37,515.04 | 0.370 | 182,306.68 | 0.001 | 4.86x | 235,061.77 | 0.001 | 6.27x |
| Counter increment | 41,124.42 | 0.371 | 9,767.3 | 1.49 | 0.24x | 12,509.76 | 1.06 | 0.3x |
| Set add | 49,155.66 | 0.309 | 4,324.71 | 2.42 | 0.09x | 6,665.6 | 1.69 | 0.14x |
| Pub/Sub publish | 51,000.42 | 0.312 | 10,500.46 | 1.07 | 0.21x | 15,355.17 | 0.873 | 0.3x |

## L1 Read Cache

These rows isolate pgredis local memory cache behavior. Mixed hit-rate rows include PostgreSQL misses and are closer to real cache-aside usage than the 100% hot-cache row.

| Operation | Redis | Redis p50 ms | Node PG L1 | Node PG L1 p50 ms | Node PG L1/Redis | Bun PG L1 | Bun PG L1 p50 ms | Bun PG L1/Redis |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| KV read (hot cache) | 39,507.49 | 0.383 | 1,222,041.22 | 0.011 | 30.93x | 568,568.19 | 0.023 | 14.39x |
| KV read (99% L1) | 43,745.82 | 0.348 | 659,019.41 | 0.003 | 15.06x | 427,833.29 | 0.008 | 9.78x |
| KV read (95% L1) | 41,929.54 | 0.381 | 208,880.75 | 0.001 | 4.98x | 287,050.84 | 0.002 | 6.85x |
| KV read (90% L1) | 37,515.04 | 0.370 | 182,306.68 | 0.001 | 4.86x | 235,061.77 | 0.001 | 6.27x |

## L2 Backend Path

These rows disable pgredis L1 and measure direct PostgreSQL access. They are useful for fallback sizing and regression tracking, not as the main cache-hit comparison.

| Operation | Redis | Redis p50 ms | Node PG L2 | Node PG L2 p50 ms | Node PG L2/Redis | Bun PG L2 | Bun PG L2 p50 ms | Bun PG L2/Redis |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| KV write | 29,347.81 | 0.471 | 6,034.33 | 1.89 | 0.21x | 13,662.3 | 0.974 | 0.47x |
| KV write (batch) | 156,679.9 | 1.38 | 43,795.39 | 5.57 | 0.28x | 62,552.95 | 3.83 | 0.4x |
| KV read | 39,554.14 | 0.390 | 8,292.8 | 1.63 | 0.21x | 18,437.81 | 0.779 | 0.47x |
| KV read (batch) | 312,171.63 | 0.776 | 91,899.09 | 2.23 | 0.29x | 129,904.98 | 1.55 | 0.42x |
| KV read (hot cache) | 39,507.49 | 0.383 | 8,985.06 | 1.51 | 0.23x | 22,219.58 | 0.671 | 0.56x |
| KV read (99% L1) | 43,745.82 | 0.348 | 9,141.67 | 1.50 | 0.21x | 21,299.12 | 0.698 | 0.49x |
| KV read (95% L1) | 41,929.54 | 0.381 | 9,338.72 | 1.44 | 0.22x | 20,259.84 | 0.732 | 0.48x |
| KV read (90% L1) | 37,515.04 | 0.370 | 9,014.32 | 1.51 | 0.24x | 19,895.54 | 0.734 | 0.53x |
| Counter increment | 41,124.42 | 0.371 | 9,767.3 | 1.49 | 0.24x | 12,509.76 | 1.06 | 0.3x |
| Set add | 49,155.66 | 0.309 | 4,324.71 | 2.42 | 0.09x | 6,665.6 | 1.69 | 0.14x |
| Pub/Sub publish | 51,000.42 | 0.312 | 10,500.46 | 1.07 | 0.21x | 15,355.17 | 0.873 | 0.3x |

## Details

| Operation | Backend | Iterations | Concurrency | Duration ms | Ops/sec | Avg ms | p50 ms | p99 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| KV write | Node.js + Redis | 2000 | 16 | 68.15 | 29,347.81 | 0.538 | 0.471 | 1.54 |
| KV write (batch) | Node.js + Redis | 2000 | 16 | 12.76 | 156,679.9 | 1.48 | 1.38 | 2.69 |
| KV read | Node.js + Redis | 2000 | 16 | 50.56 | 39,554.14 | 0.402 | 0.390 | 0.852 |
| KV read (batch) | Node.js + Redis | 2000 | 16 | 6.41 | 312,171.63 | 0.765 | 0.776 | 1.09 |
| KV read (hot cache) | Node.js + Redis | 2000 | 16 | 50.62 | 39,507.49 | 0.402 | 0.383 | 0.946 |
| KV read (99% L1) | Node.js + Redis | 2000 | 16 | 45.72 | 43,745.82 | 0.363 | 0.348 | 0.656 |
| KV read (95% L1) | Node.js + Redis | 2000 | 16 | 47.7 | 41,929.54 | 0.379 | 0.381 | 0.535 |
| KV read (90% L1) | Node.js + Redis | 2000 | 16 | 53.31 | 37,515.04 | 0.424 | 0.370 | 2.04 |
| Counter increment | Node.js + Redis | 2000 | 16 | 48.63 | 41,124.42 | 0.385 | 0.371 | 0.644 |
| Set add | Node.js + Redis | 2000 | 16 | 40.69 | 49,155.66 | 0.323 | 0.309 | 0.482 |
| Pub/Sub publish | Node.js + Redis | 2000 | 16 | 39.22 | 51,000.42 | 0.312 | 0.312 | 0.419 |
| KV write | Node.js + PostgreSQL | 2000 | 16 | 331.44 | 6,034.33 | 2.65 | 1.89 | 7.21 |
| KV write (batch) | Node.js + PostgreSQL | 2000 | 16 | 45.67 | 43,795.39 | 5.63 | 5.57 | 11.56 |
| KV read | Node.js + PostgreSQL | 2000 | 16 | 241.17 | 8,292.8 | 1.93 | 1.63 | 4.54 |
| KV read (batch) | Node.js + PostgreSQL | 2000 | 16 | 21.76 | 91,899.09 | 2.61 | 2.23 | 5.32 |
| KV read (hot cache) | Node.js + PostgreSQL | 2000 | 16 | 222.59 | 8,985.06 | 1.78 | 1.51 | 3.45 |
| KV read (99% L1) | Node.js + PostgreSQL | 2000 | 16 | 218.78 | 9,141.67 | 1.75 | 1.50 | 3.38 |
| KV read (95% L1) | Node.js + PostgreSQL | 2000 | 16 | 214.16 | 9,338.72 | 1.71 | 1.44 | 3.38 |
| KV read (90% L1) | Node.js + PostgreSQL | 2000 | 16 | 221.87 | 9,014.32 | 1.77 | 1.51 | 4.76 |
| Counter increment | Node.js + PostgreSQL | 2000 | 16 | 204.76 | 9,767.3 | 1.61 | 1.49 | 3.61 |
| Set add | Node.js + PostgreSQL | 2000 | 16 | 462.46 | 4,324.71 | 3.69 | 2.42 | 34.38 |
| Pub/Sub publish | Node.js + PostgreSQL | 2000 | 16 | 190.47 | 10,500.46 | 1.52 | 1.07 | 2.50 |
| KV read (hot cache) | Node.js + PostgreSQL (L1) | 2000 | 16 | 1.64 | 1,222,041.22 | 0.013 | 0.011 | 0.038 |
| KV read (99% L1) | Node.js + PostgreSQL (L1) | 2000 | 16 | 3.03 | 659,019.41 | 0.023 | 0.003 | 0.550 |
| KV read (95% L1) | Node.js + PostgreSQL (L1) | 2000 | 16 | 9.57 | 208,880.75 | 0.075 | 0.001 | 2.11 |
| KV read (90% L1) | Node.js + PostgreSQL (L1) | 2000 | 16 | 10.97 | 182,306.68 | 0.086 | 0.001 | 2.41 |
| KV write | Bun.js + PostgreSQL | 2000 | 16 | 146.39 | 13,662.3 | 1.16 | 0.974 | 3.78 |
| KV write (batch) | Bun.js + PostgreSQL | 2000 | 16 | 31.97 | 62,552.95 | 3.88 | 3.83 | 7.71 |
| KV read | Bun.js + PostgreSQL | 2000 | 16 | 108.47 | 18,437.81 | 0.864 | 0.779 | 2.45 |
| KV read (batch) | Bun.js + PostgreSQL | 2000 | 16 | 15.4 | 129,904.98 | 1.86 | 1.55 | 4.00 |
| KV read (hot cache) | Bun.js + PostgreSQL | 2000 | 16 | 90.01 | 22,219.58 | 0.718 | 0.671 | 1.76 |
| KV read (99% L1) | Bun.js + PostgreSQL | 2000 | 16 | 93.9 | 21,299.12 | 0.749 | 0.698 | 1.73 |
| KV read (95% L1) | Bun.js + PostgreSQL | 2000 | 16 | 98.72 | 20,259.84 | 0.788 | 0.732 | 1.73 |
| KV read (90% L1) | Bun.js + PostgreSQL | 2000 | 16 | 100.53 | 19,895.54 | 0.802 | 0.734 | 1.84 |
| Counter increment | Bun.js + PostgreSQL | 2000 | 16 | 159.88 | 12,509.76 | 1.27 | 1.06 | 4.11 |
| Set add | Bun.js + PostgreSQL | 2000 | 16 | 300.05 | 6,665.6 | 2.39 | 1.69 | 22.86 |
| Pub/Sub publish | Bun.js + PostgreSQL | 2000 | 16 | 130.25 | 15,355.17 | 1.04 | 0.873 | 2.24 |
| KV read (hot cache) | Bun.js + PostgreSQL (L1) | 2000 | 16 | 3.52 | 568,568.19 | 0.027 | 0.023 | 0.070 |
| KV read (99% L1) | Bun.js + PostgreSQL (L1) | 2000 | 16 | 4.67 | 427,833.29 | 0.036 | 0.008 | 0.247 |
| KV read (95% L1) | Bun.js + PostgreSQL (L1) | 2000 | 16 | 6.97 | 287,050.84 | 0.053 | 0.002 | 1.49 |
| KV read (90% L1) | Bun.js + PostgreSQL (L1) | 2000 | 16 | 8.51 | 235,061.77 | 0.067 | 0.001 | 1.80 |

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

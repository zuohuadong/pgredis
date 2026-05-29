# Benchmark

Generated at: 2026-05-29T16:03:26.799Z

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

## L1 Read Cache

These rows isolate pgredis local memory cache behavior. Mixed hit-rate rows include PostgreSQL misses and are closer to real cache-aside usage than the 100% hot-cache row.

| Operation | Redis | Redis p50 ms | Node PG L1 | Node PG L1 p50 ms | Node PG L1/Redis | Bun PG L1 | Bun PG L1 p50 ms | Bun PG L1/Redis |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| KV read (hot cache) | 37,602.19 | 0.415 | 901,104.66 | 0.016 | 23.96x | 619,447.43 | 0.021 | 16.47x |
| KV read (99% L1) | 42,460.93 | 0.357 | 477,782.63 | 0.007 | 11.25x | 434,269.23 | 0.008 | 10.23x |
| KV read (95% L1) | 40,009.74 | 0.384 | 214,798.36 | 0.001 | 5.37x | 256,005.83 | 0.001 | 6.4x |
| KV read (90% L1) | 35,894.88 | 0.372 | 183,818.19 | 0.001 | 5.12x | 236,572.39 | 0.001 | 6.59x |

## L2 Backend Path

These rows disable pgredis L1 and measure direct PostgreSQL access. They are useful for fallback sizing and regression tracking, not as the main cache-hit comparison.

| Operation | Redis | Redis p50 ms | Node PG L2 | Node PG L2 p50 ms | Node PG L2/Redis | Bun PG L2 | Bun PG L2 p50 ms | Bun PG L2/Redis |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| KV write | 27,398.35 | 0.476 | 5,524.63 | 2.28 | 0.2x | 12,983.17 | 1.04 | 0.47x |
| KV write (batch) | 141,330.47 | 1.73 | 41,304.25 | 5.07 | 0.29x | 60,076.97 | 3.99 | 0.43x |
| KV read | 39,903.69 | 0.384 | 8,367.31 | 1.68 | 0.21x | 17,620.89 | 0.782 | 0.44x |
| KV read (batch) | 271,394.98 | 0.770 | 94,934.82 | 2.19 | 0.35x | 134,125.41 | 1.32 | 0.49x |
| KV read (hot cache) | 37,602.19 | 0.415 | 8,859.64 | 1.61 | 0.24x | 20,383.38 | 0.725 | 0.54x |
| KV read (99% L1) | 42,460.93 | 0.357 | 9,141.39 | 1.64 | 0.22x | 18,942.11 | 0.758 | 0.45x |
| KV read (95% L1) | 40,009.74 | 0.384 | 9,359.34 | 1.57 | 0.23x | 20,044.23 | 0.745 | 0.5x |
| KV read (90% L1) | 35,894.88 | 0.372 | 8,728.28 | 1.62 | 0.24x | 20,911.42 | 0.676 | 0.58x |
| Counter increment | 43,657.29 | 0.345 | 9,250.29 | 1.57 | 0.21x | 14,680.9 | 0.923 | 0.34x |
| Set add | 46,257.37 | 0.322 | 4,088.86 | 2.55 | 0.09x | 6,259.36 | 1.70 | 0.14x |
| Pub/Sub publish | 48,886.72 | 0.324 | 12,997.21 | 1.16 | 0.27x | 17,574.34 | 0.805 | 0.36x |

## Details

| Operation | Backend | Iterations | Concurrency | Duration ms | Ops/sec | Avg ms | p50 ms | p99 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| KV write | Node.js + Redis | 2000 | 16 | 73 | 27,398.35 | 0.573 | 0.476 | 2.06 |
| KV write (batch) | Node.js + Redis | 2000 | 16 | 14.15 | 141,330.47 | 1.66 | 1.73 | 2.44 |
| KV read | Node.js + Redis | 2000 | 16 | 50.12 | 39,903.69 | 0.398 | 0.384 | 0.860 |
| KV read (batch) | Node.js + Redis | 2000 | 16 | 7.37 | 271,394.98 | 0.882 | 0.770 | 1.76 |
| KV read (hot cache) | Node.js + Redis | 2000 | 16 | 53.19 | 37,602.19 | 0.423 | 0.415 | 0.683 |
| KV read (99% L1) | Node.js + Redis | 2000 | 16 | 47.1 | 42,460.93 | 0.374 | 0.357 | 0.558 |
| KV read (95% L1) | Node.js + Redis | 2000 | 16 | 49.99 | 40,009.74 | 0.398 | 0.384 | 0.585 |
| KV read (90% L1) | Node.js + Redis | 2000 | 16 | 55.72 | 35,894.88 | 0.443 | 0.372 | 2.33 |
| Counter increment | Node.js + Redis | 2000 | 16 | 45.81 | 43,657.29 | 0.361 | 0.345 | 0.933 |
| Set add | Node.js + Redis | 2000 | 16 | 43.24 | 46,257.37 | 0.344 | 0.322 | 0.653 |
| Pub/Sub publish | Node.js + Redis | 2000 | 16 | 40.91 | 48,886.72 | 0.325 | 0.324 | 0.452 |
| KV write | Node.js + PostgreSQL | 2000 | 16 | 362.02 | 5,524.63 | 2.89 | 2.28 | 7.93 |
| KV write (batch) | Node.js + PostgreSQL | 2000 | 16 | 48.42 | 41,304.25 | 5.95 | 5.07 | 19.20 |
| KV read | Node.js + PostgreSQL | 2000 | 16 | 239.03 | 8,367.31 | 1.91 | 1.68 | 4.08 |
| KV read (batch) | Node.js + PostgreSQL | 2000 | 16 | 21.07 | 94,934.82 | 2.61 | 2.19 | 6.45 |
| KV read (hot cache) | Node.js + PostgreSQL | 2000 | 16 | 225.74 | 8,859.64 | 1.80 | 1.61 | 4.14 |
| KV read (99% L1) | Node.js + PostgreSQL | 2000 | 16 | 218.79 | 9,141.39 | 1.75 | 1.64 | 3.83 |
| KV read (95% L1) | Node.js + PostgreSQL | 2000 | 16 | 213.69 | 9,359.34 | 1.71 | 1.57 | 3.51 |
| KV read (90% L1) | Node.js + PostgreSQL | 2000 | 16 | 229.14 | 8,728.28 | 1.83 | 1.62 | 4.84 |
| Counter increment | Node.js + PostgreSQL | 2000 | 16 | 216.21 | 9,250.29 | 1.72 | 1.57 | 4.11 |
| Set add | Node.js + PostgreSQL | 2000 | 16 | 489.13 | 4,088.86 | 3.90 | 2.55 | 37.06 |
| Pub/Sub publish | Node.js + PostgreSQL | 2000 | 16 | 153.88 | 12,997.21 | 1.23 | 1.16 | 2.47 |
| KV read (hot cache) | Node.js + PostgreSQL (L1) | 2000 | 16 | 2.22 | 901,104.66 | 0.017 | 0.016 | 0.051 |
| KV read (99% L1) | Node.js + PostgreSQL (L1) | 2000 | 16 | 4.19 | 477,782.63 | 0.029 | 0.007 | 0.649 |
| KV read (95% L1) | Node.js + PostgreSQL (L1) | 2000 | 16 | 9.31 | 214,798.36 | 0.070 | 0.001 | 1.93 |
| KV read (90% L1) | Node.js + PostgreSQL (L1) | 2000 | 16 | 10.88 | 183,818.19 | 0.086 | 0.001 | 2.22 |
| KV write | Bun.js + PostgreSQL | 2000 | 16 | 154.05 | 12,983.17 | 1.23 | 1.04 | 4.71 |
| KV write (batch) | Bun.js + PostgreSQL | 2000 | 16 | 33.29 | 60,076.97 | 4.03 | 3.99 | 9.09 |
| KV read | Bun.js + PostgreSQL | 2000 | 16 | 113.5 | 17,620.89 | 0.902 | 0.782 | 2.75 |
| KV read (batch) | Bun.js + PostgreSQL | 2000 | 16 | 14.91 | 134,125.41 | 1.82 | 1.32 | 8.71 |
| KV read (hot cache) | Bun.js + PostgreSQL | 2000 | 16 | 98.12 | 20,383.38 | 0.781 | 0.725 | 1.93 |
| KV read (99% L1) | Bun.js + PostgreSQL | 2000 | 16 | 105.58 | 18,942.11 | 0.842 | 0.758 | 2.13 |
| KV read (95% L1) | Bun.js + PostgreSQL | 2000 | 16 | 99.78 | 20,044.23 | 0.795 | 0.745 | 1.95 |
| KV read (90% L1) | Bun.js + PostgreSQL | 2000 | 16 | 95.64 | 20,911.42 | 0.764 | 0.676 | 2.12 |
| Counter increment | Bun.js + PostgreSQL | 2000 | 16 | 136.23 | 14,680.9 | 1.08 | 0.923 | 3.39 |
| Set add | Bun.js + PostgreSQL | 2000 | 16 | 319.52 | 6,259.36 | 2.55 | 1.70 | 29.27 |
| Pub/Sub publish | Bun.js + PostgreSQL | 2000 | 16 | 113.8 | 17,574.34 | 0.906 | 0.805 | 2.66 |
| KV read (hot cache) | Bun.js + PostgreSQL (L1) | 2000 | 16 | 3.23 | 619,447.43 | 0.025 | 0.021 | 0.072 |
| KV read (99% L1) | Bun.js + PostgreSQL (L1) | 2000 | 16 | 4.61 | 434,269.23 | 0.034 | 0.008 | 0.664 |
| KV read (95% L1) | Bun.js + PostgreSQL (L1) | 2000 | 16 | 7.81 | 256,005.83 | 0.058 | 0.001 | 1.95 |
| KV read (90% L1) | Bun.js + PostgreSQL (L1) | 2000 | 16 | 8.45 | 236,572.39 | 0.063 | 0.001 | 1.62 |

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

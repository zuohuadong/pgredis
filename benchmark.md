# Benchmark

Generated at: 2026-05-27T02:10:56.906Z

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

| Operation | Redis | Node PG mode | Node PG | Node PG/Redis | Bun PG mode | Bun PG | Bun PG/Redis |
| --- | ---: | --- | ---: | ---: | --- | ---: | ---: |
| KV write | 36,476.84 | L2 | 6,466.2 | 0.18x | L2 | 16,403.11 | 0.45x |
| KV write (batch) | 241,170.45 | L2 | 46,205.77 | 0.19x | L2 | 74,073.78 | 0.31x |
| KV read | 45,835.6 | L2 | 9,170.15 | 0.2x | L2 | 22,810.36 | 0.5x |
| KV read (batch) | 318,907.14 | L2 | 107,735.71 | 0.34x | L2 | 144,483.81 | 0.45x |
| KV read (hot cache) | 50,328.62 | L1 | 1,608,905.61 | 31.97x | L1 | 679,338.37 | 13.5x |
| KV read (99% L1) | 53,499.81 | L1 | 748,460.7 | 13.99x | L1 | 513,782.34 | 9.6x |
| KV read (95% L1) | 58,313.35 | L1 | 241,084.28 | 4.13x | L1 | 345,244.08 | 5.92x |
| KV read (90% L1) | 42,919.33 | L1 | 204,774.56 | 4.77x | L1 | 302,275.58 | 7.04x |
| Counter increment | 53,531.96 | L2 | 10,184.12 | 0.19x | L2 | 13,568.16 | 0.25x |
| Set add | 54,369.65 | L2 | 4,677.43 | 0.09x | L2 | 7,247.38 | 0.13x |
| Pub/Sub publish | 62,494.94 | L2 | 13,445.22 | 0.22x | L2 | 21,157.28 | 0.34x |

## L1 Read Cache

These rows isolate pgredis local memory cache behavior. Mixed hit-rate rows include PostgreSQL misses and are closer to real cache-aside usage than the 100% hot-cache row.

| Operation | Redis | Node PG L1 | Node PG L1/Redis | Bun PG L1 | Bun PG L1/Redis |
| --- | ---: | ---: | ---: | ---: | ---: |
| KV read (hot cache) | 50,328.62 | 1,608,905.61 | 31.97x | 679,338.37 | 13.5x |
| KV read (99% L1) | 53,499.81 | 748,460.7 | 13.99x | 513,782.34 | 9.6x |
| KV read (95% L1) | 58,313.35 | 241,084.28 | 4.13x | 345,244.08 | 5.92x |
| KV read (90% L1) | 42,919.33 | 204,774.56 | 4.77x | 302,275.58 | 7.04x |

## L2 Backend Path

These rows disable pgredis L1 and measure direct PostgreSQL access. They are useful for fallback sizing and regression tracking, not as the main cache-hit comparison.

| Operation | Redis | Node PG L2 | Node PG L2/Redis | Bun PG L2 | Bun PG L2/Redis |
| --- | ---: | ---: | ---: | ---: | ---: |
| KV write | 36,476.84 | 6,466.2 | 0.18x | 16,403.11 | 0.45x |
| KV write (batch) | 241,170.45 | 46,205.77 | 0.19x | 74,073.78 | 0.31x |
| KV read | 45,835.6 | 9,170.15 | 0.2x | 22,810.36 | 0.5x |
| KV read (batch) | 318,907.14 | 107,735.71 | 0.34x | 144,483.81 | 0.45x |
| KV read (hot cache) | 50,328.62 | 10,333.54 | 0.21x | 26,620.34 | 0.53x |
| KV read (99% L1) | 53,499.81 | 10,974.6 | 0.21x | 26,035.4 | 0.49x |
| KV read (95% L1) | 58,313.35 | 11,485 | 0.2x | 26,106.67 | 0.45x |
| KV read (90% L1) | 42,919.33 | 10,493.14 | 0.24x | 25,991.48 | 0.61x |
| Counter increment | 53,531.96 | 10,184.12 | 0.19x | 13,568.16 | 0.25x |
| Set add | 54,369.65 | 4,677.43 | 0.09x | 7,247.38 | 0.13x |
| Pub/Sub publish | 62,494.94 | 13,445.22 | 0.22x | 21,157.28 | 0.34x |

## Details

| Operation | Backend | Iterations | Concurrency | Duration ms | Ops/sec |
| --- | --- | ---: | ---: | ---: | ---: |
| KV write | Node.js + Redis | 2000 | 16 | 54.83 | 36,476.84 |
| KV write (batch) | Node.js + Redis | 2000 | 16 | 8.29 | 241,170.45 |
| KV read | Node.js + Redis | 2000 | 16 | 43.63 | 45,835.6 |
| KV read (batch) | Node.js + Redis | 2000 | 16 | 6.27 | 318,907.14 |
| KV read (hot cache) | Node.js + Redis | 2000 | 16 | 39.74 | 50,328.62 |
| KV read (99% L1) | Node.js + Redis | 2000 | 16 | 37.38 | 53,499.81 |
| KV read (95% L1) | Node.js + Redis | 2000 | 16 | 34.3 | 58,313.35 |
| KV read (90% L1) | Node.js + Redis | 2000 | 16 | 46.6 | 42,919.33 |
| Counter increment | Node.js + Redis | 2000 | 16 | 37.36 | 53,531.96 |
| Set add | Node.js + Redis | 2000 | 16 | 36.79 | 54,369.65 |
| Pub/Sub publish | Node.js + Redis | 2000 | 16 | 32 | 62,494.94 |
| KV write | Node.js + PostgreSQL | 2000 | 16 | 309.3 | 6,466.2 |
| KV write (batch) | Node.js + PostgreSQL | 2000 | 16 | 43.28 | 46,205.77 |
| KV read | Node.js + PostgreSQL | 2000 | 16 | 218.1 | 9,170.15 |
| KV read (batch) | Node.js + PostgreSQL | 2000 | 16 | 18.56 | 107,735.71 |
| KV read (hot cache) | Node.js + PostgreSQL | 2000 | 16 | 193.54 | 10,333.54 |
| KV read (99% L1) | Node.js + PostgreSQL | 2000 | 16 | 182.24 | 10,974.6 |
| KV read (95% L1) | Node.js + PostgreSQL | 2000 | 16 | 174.14 | 11,485 |
| KV read (90% L1) | Node.js + PostgreSQL | 2000 | 16 | 190.6 | 10,493.14 |
| Counter increment | Node.js + PostgreSQL | 2000 | 16 | 196.38 | 10,184.12 |
| Set add | Node.js + PostgreSQL | 2000 | 16 | 427.59 | 4,677.43 |
| Pub/Sub publish | Node.js + PostgreSQL | 2000 | 16 | 148.75 | 13,445.22 |
| KV read (hot cache) | Node.js + PostgreSQL (L1) | 2000 | 16 | 1.24 | 1,608,905.61 |
| KV read (99% L1) | Node.js + PostgreSQL (L1) | 2000 | 16 | 2.67 | 748,460.7 |
| KV read (95% L1) | Node.js + PostgreSQL (L1) | 2000 | 16 | 8.3 | 241,084.28 |
| KV read (90% L1) | Node.js + PostgreSQL (L1) | 2000 | 16 | 9.77 | 204,774.56 |
| KV write | Bun.js + PostgreSQL | 2000 | 16 | 121.93 | 16,403.11 |
| KV write (batch) | Bun.js + PostgreSQL | 2000 | 16 | 27 | 74,073.78 |
| KV read | Bun.js + PostgreSQL | 2000 | 16 | 87.68 | 22,810.36 |
| KV read (batch) | Bun.js + PostgreSQL | 2000 | 16 | 13.84 | 144,483.81 |
| KV read (hot cache) | Bun.js + PostgreSQL | 2000 | 16 | 75.13 | 26,620.34 |
| KV read (99% L1) | Bun.js + PostgreSQL | 2000 | 16 | 76.82 | 26,035.4 |
| KV read (95% L1) | Bun.js + PostgreSQL | 2000 | 16 | 76.61 | 26,106.67 |
| KV read (90% L1) | Bun.js + PostgreSQL | 2000 | 16 | 76.95 | 25,991.48 |
| Counter increment | Bun.js + PostgreSQL | 2000 | 16 | 147.4 | 13,568.16 |
| Set add | Bun.js + PostgreSQL | 2000 | 16 | 275.96 | 7,247.38 |
| Pub/Sub publish | Bun.js + PostgreSQL | 2000 | 16 | 94.53 | 21,157.28 |
| KV read (hot cache) | Bun.js + PostgreSQL (L1) | 2000 | 16 | 2.94 | 679,338.37 |
| KV read (99% L1) | Bun.js + PostgreSQL (L1) | 2000 | 16 | 3.89 | 513,782.34 |
| KV read (95% L1) | Bun.js + PostgreSQL (L1) | 2000 | 16 | 5.79 | 345,244.08 |
| KV read (90% L1) | Bun.js + PostgreSQL (L1) | 2000 | 16 | 6.62 | 302,275.58 |

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

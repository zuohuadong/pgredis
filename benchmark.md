# Benchmark

<<<<<<< Updated upstream
Generated at: 2026-05-26T23:32:26.500Z
=======
Generated at: 2026-05-26T23:33:02.731Z
>>>>>>> Stashed changes

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
<<<<<<< Updated upstream
| KV write | 29,465.18 | 6,488.24 | 0.22x | - | - | 11,252.36 | 0.38x | - | - |
| KV write (batch) | 193,813.98 | 37,756.02 | 0.19x | - | - | 55,327.32 | 0.29x | - | - |
| KV read | 37,239.42 | 8,250.54 | 0.22x | - | - | 12,090.93 | 0.32x | - | - |
| KV read (batch) | 272,167.61 | 85,085.01 | 0.31x | - | - | 109,347.63 | 0.4x | - | - |
| KV read (hot cache) | 39,693.54 | 8,559.22 | 0.22x | 1,579,536.79 | 39.79x | 15,334.61 | 0.39x | 530,905.04 | 13.38x |
| Counter increment | 44,299.31 | 8,488.17 | 0.19x | - | - | 9,717.07 | 0.22x | - | - |
| Set add | 46,720.13 | 4,118.8 | 0.09x | - | - | 5,702.62 | 0.12x | - | - |
| Pub/Sub publish | 38,560.53 | 8,908.52 | 0.23x | - | - | 15,087.23 | 0.39x | - | - |
=======
| KV write | 29,372.61 | 6,630.52 | 0.23x | - | - | 11,028.41 | 0.38x | - | - |
| KV write (batch) | 215,072.84 | 38,596.93 | 0.18x | - | - | 51,424.65 | 0.24x | - | - |
| KV read | 37,792.58 | 8,460.09 | 0.22x | - | - | 13,686.15 | 0.36x | - | - |
| KV read (batch) | 290,860.27 | 93,935.92 | 0.32x | - | - | 100,910.07 | 0.35x | - | - |
| KV read (hot cache) | 39,255.05 | 7,756.52 | 0.2x | 1,072,849.14 | 27.33x | 14,280.43 | 0.36x | 542,293.03 | 13.81x |
| Counter increment | 43,792.67 | 6,739.55 | 0.15x | - | - | 10,358.84 | 0.24x | - | - |
| Set add | 46,427.3 | 4,011.95 | 0.09x | - | - | 5,870.68 | 0.13x | - | - |
| Pub/Sub publish | 38,458.52 | 9,084.51 | 0.24x | - | - | 13,478.84 | 0.35x | - | - |
>>>>>>> Stashed changes

## Details

| Operation | Backend | Iterations | Concurrency | Duration ms | Ops/sec |
| --- | --- | ---: | ---: | ---: | ---: |
<<<<<<< Updated upstream
| KV write | Node.js + Redis | 2000 | 16 | 67.88 | 29,465.18 |
| KV write (batch) | Node.js + Redis | 2000 | 16 | 10.32 | 193,813.98 |
| KV read | Node.js + Redis | 2000 | 16 | 53.71 | 37,239.42 |
| KV read (batch) | Node.js + Redis | 2000 | 16 | 7.35 | 272,167.61 |
| KV read (hot cache) | Node.js + Redis | 2000 | 16 | 50.39 | 39,693.54 |
| Counter increment | Node.js + Redis | 2000 | 16 | 45.15 | 44,299.31 |
| Set add | Node.js + Redis | 2000 | 16 | 42.81 | 46,720.13 |
| Pub/Sub publish | Node.js + Redis | 2000 | 16 | 51.87 | 38,560.53 |
| KV write | Node.js + PostgreSQL | 2000 | 16 | 308.25 | 6,488.24 |
| KV write (batch) | Node.js + PostgreSQL | 2000 | 16 | 52.97 | 37,756.02 |
| KV read | Node.js + PostgreSQL | 2000 | 16 | 242.41 | 8,250.54 |
| KV read (batch) | Node.js + PostgreSQL | 2000 | 16 | 23.51 | 85,085.01 |
| KV read (hot cache) | Node.js + PostgreSQL | 2000 | 16 | 233.67 | 8,559.22 |
| Counter increment | Node.js + PostgreSQL | 2000 | 16 | 235.62 | 8,488.17 |
| Set add | Node.js + PostgreSQL | 2000 | 16 | 485.58 | 4,118.8 |
| Pub/Sub publish | Node.js + PostgreSQL | 2000 | 16 | 224.5 | 8,908.52 |
| KV read (hot cache) | Node.js + PostgreSQL (L1) | 2000 | 16 | 1.27 | 1,579,536.79 |
| KV write | Bun.js + PostgreSQL | 2000 | 16 | 177.74 | 11,252.36 |
| KV write (batch) | Bun.js + PostgreSQL | 2000 | 16 | 36.15 | 55,327.32 |
| KV read | Bun.js + PostgreSQL | 2000 | 16 | 165.41 | 12,090.93 |
| KV read (batch) | Bun.js + PostgreSQL | 2000 | 16 | 18.29 | 109,347.63 |
| KV read (hot cache) | Bun.js + PostgreSQL | 2000 | 16 | 130.42 | 15,334.61 |
| Counter increment | Bun.js + PostgreSQL | 2000 | 16 | 205.82 | 9,717.07 |
| Set add | Bun.js + PostgreSQL | 2000 | 16 | 350.72 | 5,702.62 |
| Pub/Sub publish | Bun.js + PostgreSQL | 2000 | 16 | 132.56 | 15,087.23 |
| KV read (hot cache) | Bun.js + PostgreSQL (L1) | 2000 | 16 | 3.77 | 530,905.04 |
=======
| KV write | Node.js + Redis | 2000 | 16 | 68.09 | 29,372.61 |
| KV write (batch) | Node.js + Redis | 2000 | 16 | 9.3 | 215,072.84 |
| KV read | Node.js + Redis | 2000 | 16 | 52.92 | 37,792.58 |
| KV read (batch) | Node.js + Redis | 2000 | 16 | 6.88 | 290,860.27 |
| KV read (hot cache) | Node.js + Redis | 2000 | 16 | 50.95 | 39,255.05 |
| Counter increment | Node.js + Redis | 2000 | 16 | 45.67 | 43,792.67 |
| Set add | Node.js + Redis | 2000 | 16 | 43.08 | 46,427.3 |
| Pub/Sub publish | Node.js + Redis | 2000 | 16 | 52 | 38,458.52 |
| KV write | Node.js + PostgreSQL | 2000 | 16 | 301.64 | 6,630.52 |
| KV write (batch) | Node.js + PostgreSQL | 2000 | 16 | 51.82 | 38,596.93 |
| KV read | Node.js + PostgreSQL | 2000 | 16 | 236.4 | 8,460.09 |
| KV read (batch) | Node.js + PostgreSQL | 2000 | 16 | 21.29 | 93,935.92 |
| KV read (hot cache) | Node.js + PostgreSQL | 2000 | 16 | 257.85 | 7,756.52 |
| Counter increment | Node.js + PostgreSQL | 2000 | 16 | 296.76 | 6,739.55 |
| Set add | Node.js + PostgreSQL | 2000 | 16 | 498.51 | 4,011.95 |
| Pub/Sub publish | Node.js + PostgreSQL | 2000 | 16 | 220.15 | 9,084.51 |
| KV read (hot cache) | Node.js + PostgreSQL (L1) | 2000 | 16 | 1.86 | 1,072,849.14 |
| KV write | Bun.js + PostgreSQL | 2000 | 16 | 181.35 | 11,028.41 |
| KV write (batch) | Bun.js + PostgreSQL | 2000 | 16 | 38.89 | 51,424.65 |
| KV read | Bun.js + PostgreSQL | 2000 | 16 | 146.13 | 13,686.15 |
| KV read (batch) | Bun.js + PostgreSQL | 2000 | 16 | 19.82 | 100,910.07 |
| KV read (hot cache) | Bun.js + PostgreSQL | 2000 | 16 | 140.05 | 14,280.43 |
| Counter increment | Bun.js + PostgreSQL | 2000 | 16 | 193.07 | 10,358.84 |
| Set add | Bun.js + PostgreSQL | 2000 | 16 | 340.68 | 5,870.68 |
| Pub/Sub publish | Bun.js + PostgreSQL | 2000 | 16 | 148.38 | 13,478.84 |
| KV read (hot cache) | Bun.js + PostgreSQL (L1) | 2000 | 16 | 3.69 | 542,293.03 |
>>>>>>> Stashed changes

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

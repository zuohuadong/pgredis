# Benchmark

Generated at: 2026-05-26T10:17:28.020Z

Iterations per case: 2000
Concurrency per case: 16

Services:

- Redis and PostgreSQL run on the same GitHub Actions runner in the benchmark workflow.
- The benchmark workflow runs PostgreSQL 18 with asynchronous I/O enabled via `io_method=worker`.
- The workflow gives both service containers `--cpus 2 --memory 2g`.
- Node.js tests run with `node`; Bun.js tests run with `bun`.
- PostgreSQL tests use `@postgresx/noredis` with the local L1 cache disabled so reads hit PostgreSQL.

## Summary

Ops/sec is higher-is-better. Ratios compare each PostgreSQL backend against the Node.js + Redis baseline for the same operation.

| Operation | Node.js + Redis ops/sec | Node.js + PostgreSQL ops/sec | Node/Postgres vs Redis | Bun.js + PostgreSQL ops/sec | Bun/Postgres vs Redis | Fastest |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| KV write | 28,770.51 | 6,178.66 | 0.21x | 13,439.64 | 0.47x | Node.js + Redis |
| KV read | 34,956.09 | 8,037.09 | 0.23x | 17,352.22 | 0.5x | Node.js + Redis |
| Counter increment | 41,340.15 | 8,057.64 | 0.19x | 11,034.95 | 0.27x | Node.js + Redis |
| Set add | 40,436.36 | 4,066.7 | 0.1x | 6,473.2 | 0.16x | Node.js + Redis |
| Pub/Sub publish | 39,987.24 | 11,137.25 | 0.28x | 15,310.95 | 0.38x | Node.js + Redis |

## Details

| Operation | Backend | Iterations | Concurrency | Duration ms | Ops/sec |
| --- | --- | ---: | ---: | ---: | ---: |
| KV write | Node.js + Redis | 2000 | 16 | 69.52 | 28,770.51 |
| KV read | Node.js + Redis | 2000 | 16 | 57.21 | 34,956.09 |
| Counter increment | Node.js + Redis | 2000 | 16 | 48.38 | 41,340.15 |
| Set add | Node.js + Redis | 2000 | 16 | 49.46 | 40,436.36 |
| Pub/Sub publish | Node.js + Redis | 2000 | 16 | 50.02 | 39,987.24 |
| KV write | Node.js + PostgreSQL | 2000 | 16 | 323.7 | 6,178.66 |
| KV read | Node.js + PostgreSQL | 2000 | 16 | 248.85 | 8,037.09 |
| Counter increment | Node.js + PostgreSQL | 2000 | 16 | 248.21 | 8,057.64 |
| Set add | Node.js + PostgreSQL | 2000 | 16 | 491.8 | 4,066.7 |
| Pub/Sub publish | Node.js + PostgreSQL | 2000 | 16 | 179.58 | 11,137.25 |
| KV write | Bun.js + PostgreSQL | 2000 | 16 | 148.81 | 13,439.64 |
| KV read | Bun.js + PostgreSQL | 2000 | 16 | 115.26 | 17,352.22 |
| Counter increment | Bun.js + PostgreSQL | 2000 | 16 | 181.24 | 11,034.95 |
| Set add | Bun.js + PostgreSQL | 2000 | 16 | 308.97 | 6,473.2 |
| Pub/Sub publish | Bun.js + PostgreSQL | 2000 | 16 | 130.63 | 15,310.95 |

Notes:

- Redis tests use key prefixes and do not flush the whole database.
- PostgreSQL tests create temporary benchmark tables and drop them at the end.
- Numbers are intended for regression tracking, not universal database sizing.

# Benchmark

Generated at: 2026-05-26T08:15:24.182Z

Iterations per case: 2000
Concurrency per case: 16

Services:

- Redis and PostgreSQL run on the same GitHub Actions runner in the benchmark workflow.
- The workflow constrains both service containers to `--cpus 1 --memory 512m`.
- Node.js tests run with `node`; Bun.js tests run with `bun`.
- PostgreSQL tests use `@postgresx/noredis` with the local L1 cache disabled so reads hit PostgreSQL.

| Operation | Backend | Iterations | Concurrency | Duration ms | Ops/sec |
| --- | --- | ---: | ---: | ---: | ---: |
| KV write | Node.js + Redis | 2000 | 16 | 81.51 | 24,536.32 |
| KV read | Node.js + Redis | 2000 | 16 | 59.31 | 33,721.48 |
| Counter increment | Node.js + Redis | 2000 | 16 | 49.27 | 40,593.03 |
| Set add | Node.js + Redis | 2000 | 16 | 52.27 | 38,264.83 |
| Pub/Sub publish | Node.js + Redis | 2000 | 16 | 49.91 | 40,069.74 |
| KV write | Node.js + PostgreSQL | 2000 | 16 | 562.71 | 3,554.24 |
| KV read | Node.js + PostgreSQL | 2000 | 16 | 432.1 | 4,628.57 |
| Counter increment | Node.js + PostgreSQL | 2000 | 16 | 768.61 | 2,602.1 |
| Set add | Node.js + PostgreSQL | 2000 | 16 | 1,409.62 | 1,418.83 |
| Pub/Sub publish | Node.js + PostgreSQL | 2000 | 16 | 250.6 | 7,980.78 |
| KV write | Bun.js + PostgreSQL | 2000 | 16 | 302.23 | 6,617.49 |
| KV read | Bun.js + PostgreSQL | 2000 | 16 | 263.44 | 7,591.96 |
| Counter increment | Bun.js + PostgreSQL | 2000 | 16 | 623.66 | 3,206.86 |
| Set add | Bun.js + PostgreSQL | 2000 | 16 | 971.5 | 2,058.68 |
| Pub/Sub publish | Bun.js + PostgreSQL | 2000 | 16 | 165.15 | 12,109.93 |

Notes:

- Redis tests use key prefixes and do not flush the whole database.
- PostgreSQL tests create temporary benchmark tables and drop them at the end.
- Numbers are intended for regression tracking, not universal database sizing.

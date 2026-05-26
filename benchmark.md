# Benchmark

Generated at: 2026-05-26T07:22:16.133Z

Iterations per case: 2000
Concurrency per case: 16

Services:

- Redis and PostgreSQL run on the same GitHub Actions runner in the benchmark workflow.
- The workflow constrains both service containers to `--cpus 1 --memory 512m`.
- Results measure application-level calls through `ioredis`, `pg`, and `pgredis` adapters.

| Operation | Backend | Iterations | Concurrency | Duration ms | Ops/sec |
| --- | --- | ---: | ---: | ---: | ---: |
| KV write | Redis | 2000 | 16 | 41.5 | 48,188.1 |
| KV write | PostgreSQL | 2000 | 16 | 448.42 | 4,460.09 |
| KV read | Redis | 2000 | 16 | 27.06 | 73,902.16 |
| KV read | PostgreSQL | 2000 | 16 | 2.3 | 870,637.99 |
| Counter increment | Redis | 2000 | 16 | 23.97 | 83,443.83 |
| Counter increment | PostgreSQL | 2000 | 16 | 626.03 | 3,194.76 |
| Set add | Redis | 2000 | 16 | 28.01 | 71,414.08 |
| Set add | PostgreSQL | 2000 | 16 | 1,272.46 | 1,571.75 |
| Pub/Sub publish | Redis | 2000 | 16 | 23.3 | 85,845.38 |
| Pub/Sub publish | PostgreSQL | 2000 | 16 | 184.86 | 10,819.24 |

Notes:

- Redis tests use key prefixes and do not flush the whole database.
- PostgreSQL tests create temporary benchmark tables and drop them at the end.
- Numbers are intended for regression tracking, not universal database sizing.

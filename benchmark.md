# Benchmark

No current three-backend benchmark has been generated yet.

Run the manual `Benchmark` GitHub Actions workflow to compare:

- Node.js + Redis
- Node.js + PostgreSQL
- Bun.js + PostgreSQL

The workflow updates this file and the benchmark summary block in `README.md`.

PostgreSQL cache reads are measured with the local pgredis L1 cache disabled so
the read case exercises PostgreSQL instead of process memory.

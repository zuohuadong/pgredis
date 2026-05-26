import { writeFile } from "node:fs/promises";
import Redis from "ioredis";
import { createPgredis } from "../packages/pgredis/dist/index.js";
import { createPgAdapter } from "../packages/pgredis/dist/adapters/node.js";
import {
  cleanupRedis,
  dropBenchmarkTables,
  readPositiveInteger,
  runPgredisCases,
  runPgredisL1Cases,
  runRedisCases
} from "./common.mjs";

const iterations = readPositiveInteger("BENCHMARK_ITERATIONS", 2000);
const concurrency = readPositiveInteger("BENCHMARK_CONCURRENCY", 16);
const databaseUrl = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5432/pgredis";
const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const runId = process.env.BENCHMARK_RUN_ID || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const redisPrefix = `pgredis:bench:${runId}:node`;
const tablePrefix = `pgredis_bench_${runId.replace(/[^a-z0-9_]/gi, "_").toLowerCase()}_node`;

const redis = new Redis(redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: 1
});
const sql = createPgAdapter(databaseUrl);
const pg = createPgredis({
  sql,
  namespace: `${runId}:node`,
  tablePrefix,
  cache: { l1: false, notify: false }
});
const pgL1 = createPgredis({
  sql,
  namespace: `${runId}:node`,
  tablePrefix,
  cache: { l1: { max: Math.max(iterations, concurrency), ttlMs: 60_000 }, notify: false }
});

try {
  await redis.connect();
  const results = [
    ...(await runRedisCases(redis, "Node.js + Redis", redisPrefix, iterations, concurrency)),
    ...(await runPgredisCases(pg, "Node.js + PostgreSQL", tablePrefix, iterations, concurrency)),
    ...(await runPgredisL1Cases(pgL1, "Node.js + PostgreSQL (L1)", iterations, concurrency))
  ];
  await writeFile(process.env.BENCHMARK_OUTPUT || "benchmark-node.json", JSON.stringify(results, null, 2));
} finally {
  await cleanupRedis(redis, redisPrefix).catch(() => undefined);
  redis.disconnect();
  await dropBenchmarkTables(sql, tablePrefix).catch(() => undefined);
}

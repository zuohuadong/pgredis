import { writeFile } from "node:fs/promises";
import { SQL } from "bun";
import { createPgredis } from "../packages/pgredis/dist/index.js";
import { createBunSqlAdapter } from "../packages/pgredis/dist/adapters/bun.js";
import {
  dropBenchmarkTables,
  readPositiveInteger,
  runPgredisCases
} from "./common.mjs";

const iterations = readPositiveInteger("BENCHMARK_ITERATIONS", 2000);
const concurrency = readPositiveInteger("BENCHMARK_CONCURRENCY", 16);
const databaseUrl = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5432/pgredis";
const runId = process.env.BENCHMARK_RUN_ID || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const tablePrefix = `pgredis_bench_${runId.replace(/[^a-z0-9_]/gi, "_").toLowerCase()}_bun`;

const rawSql = new SQL(databaseUrl);
const sql = createBunSqlAdapter(rawSql);
const pg = createPgredis({
  sql,
  namespace: `${runId}:bun`,
  tablePrefix,
  cache: { l1: false, notify: false }
});

try {
  const results = await runPgredisCases(pg, "Bun.js + PostgreSQL", tablePrefix, iterations, concurrency);
  await writeFile(process.env.BENCHMARK_OUTPUT || "benchmark-bun.json", JSON.stringify(results, null, 2));
} finally {
  await dropBenchmarkTables(sql, tablePrefix).catch(() => undefined);
  if (typeof rawSql.close === "function") await rawSql.close();
}

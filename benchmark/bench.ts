import Redis from "ioredis";
import { createPgredis } from "../packages/pgredis/src/index";
import { createPgAdapter } from "../packages/pgredis/src/adapters/node";
import { quoteIdentifier } from "../packages/pgredis/src/sql";

interface BenchResult {
  operation: string;
  backend: "Redis" | "PostgreSQL";
  iterations: number;
  concurrency: number;
  durationMs: number;
  opsPerSecond: number;
}

const iterations = readPositiveInteger("BENCHMARK_ITERATIONS", 2000);
const concurrency = readPositiveInteger("BENCHMARK_CONCURRENCY", 16);
const databaseUrl = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5432/pgredis";
const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const runId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const redisPrefix = `pgredis:bench:${runId}`;
const tablePrefix = `pgredis_bench_${runId.replace(/[^a-z0-9_]/gi, "_").toLowerCase()}`;

function readPositiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`);
  return Math.floor(parsed);
}

async function runCase(
  operation: string,
  backend: BenchResult["backend"],
  fn: (index: number) => Promise<unknown>
): Promise<BenchResult> {
  let next = 0;
  const start = performance.now();

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const index = next++;
        if (index >= iterations) return;
        await fn(index);
      }
    })
  );

  const durationMs = performance.now() - start;
  return {
    operation,
    backend,
    iterations,
    concurrency,
    durationMs,
    opsPerSecond: iterations / (durationMs / 1000)
  };
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function markdown(results: BenchResult[]): string {
  const generatedAt = new Date().toISOString();
  const rows = results.map((result) =>
    `| ${result.operation} | ${result.backend} | ${result.iterations} | ${result.concurrency} | ${formatNumber(result.durationMs)} | ${formatNumber(result.opsPerSecond)} |`
  );

  return [
    "# Benchmark",
    "",
    `Generated at: ${generatedAt}`,
    "",
    `Iterations per case: ${iterations}`,
    `Concurrency per case: ${concurrency}`,
    "",
    "Services:",
    "",
    "- Redis and PostgreSQL run on the same GitHub Actions runner in the benchmark workflow.",
    "- The workflow constrains both service containers to `--cpus 1 --memory 512m`.",
    "- Results measure application-level calls through `ioredis`, `pg`, and `pgredis` adapters.",
    "",
    "| Operation | Backend | Iterations | Concurrency | Duration ms | Ops/sec |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
    ...rows,
    "",
    "Notes:",
    "",
    "- Redis tests use key prefixes and do not flush the whole database.",
    "- PostgreSQL tests create temporary benchmark tables and drop them at the end.",
    "- Numbers are intended for regression tracking, not universal database sizing."
  ].join("\n") + "\n";
}

async function cleanupRedis(redis: Redis): Promise<void> {
  let cursor = "0";
  do {
    const [nextCursor, keys] = await redis.scan(cursor, "MATCH", `${redisPrefix}:*`, "COUNT", 1000);
    cursor = nextCursor;
    if (keys.length > 0) await redis.del(...keys);
  } while (cursor !== "0");
}

async function dropBenchmarkTables(sql: ReturnType<typeof createPgAdapter>): Promise<void> {
  const names = ["kv", "counter", "hash", "set", "list", "sorted_set", "rate_limit"].map((name) => `${tablePrefix}_${name}`);
  for (const name of names) {
    await sql.unsafe(`DROP TABLE IF EXISTS ${quoteIdentifier(name)} CASCADE`);
  }
  await sql.close();
}

async function main(): Promise<void> {
  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1
  });
  const sql = createPgAdapter(databaseUrl);
  const pg = createPgredis({ sql, namespace: runId, tablePrefix });
  const results: BenchResult[] = [];

  await redis.connect();

  try {
    await pg.ensureSchema();

    results.push(await runCase("KV write", "Redis", (index) =>
      redis.set(`${redisPrefix}:kv:${index}`, JSON.stringify({ index }))
    ));
    results.push(await runCase("KV write", "PostgreSQL", (index) =>
      pg.cache.set(`kv:${index}`, { index }, { notify: false })
    ));

    results.push(await runCase("KV read", "Redis", async (index) => {
      await redis.get(`${redisPrefix}:kv:${index}`);
    }));
    results.push(await runCase("KV read", "PostgreSQL", async (index) => {
      await pg.cache.get(`kv:${index}`);
    }));

    results.push(await runCase("Counter increment", "Redis", (index) =>
      redis.incrby(`${redisPrefix}:counter`, index % 3 === 0 ? 2 : 1)
    ));
    results.push(await runCase("Counter increment", "PostgreSQL", (index) =>
      pg.counter.incr("counter", index % 3 === 0 ? 2 : 1)
    ));

    results.push(await runCase("Set add", "Redis", (index) =>
      redis.sadd(`${redisPrefix}:set`, `member:${index}`)
    ));
    results.push(await runCase("Set add", "PostgreSQL", (index) =>
      pg.set.sadd("set", `member:${index}`)
    ));

    results.push(await runCase("Pub/Sub publish", "Redis", (index) =>
      redis.publish(`${redisPrefix}:events`, JSON.stringify({ index }))
    ));
    results.push(await runCase("Pub/Sub publish", "PostgreSQL", (index) =>
      pg.pubsub.publish(`${tablePrefix}_events`, { index })
    ));

    await Bun.write(new URL("../benchmark.md", import.meta.url), markdown(results));
    console.log(markdown(results));
  } finally {
    await cleanupRedis(redis).catch(() => undefined);
    redis.disconnect();
    await dropBenchmarkTables(sql).catch(() => undefined);
  }
}

await main();

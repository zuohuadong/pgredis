import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

interface BenchResult {
  operation: string;
  backend: "Node.js + Redis" | "Node.js + PostgreSQL" | "Node.js + PostgreSQL (L1)" | "Bun.js + PostgreSQL" | "Bun.js + PostgreSQL (L1)";
  iterations: number;
  concurrency: number;
  durationMs: number;
  opsPerSecond: number;
}

interface ComparisonRow {
  operation: string;
  nodeRedis: BenchResult | null;
  nodePostgres: BenchResult | null;
  nodePostgresL1: BenchResult | null;
  bunPostgres: BenchResult | null;
  bunPostgresL1: BenchResult | null;
}

const exec = promisify(execFile);
const root = new URL("..", import.meta.url);
const iterations = readPositiveInteger("BENCHMARK_ITERATIONS", 2000);
const concurrency = readPositiveInteger("BENCHMARK_CONCURRENCY", 16);
const runId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

function readPositiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`);
  return Math.floor(parsed);
}

async function run(command: string, args: string[], env: Record<string, string>): Promise<void> {
  const { stdout, stderr } = await exec(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    maxBuffer: 10 * 1024 * 1024
  });
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function formatOps(result: BenchResult | null): string {
  return result ? formatNumber(result.opsPerSecond) : "-";
}

function formatRatio(result: BenchResult | null, baseline: BenchResult | null): string {
  if (!result || !baseline || baseline.opsPerSecond <= 0) return "-";
  return `${formatNumber(result.opsPerSecond / baseline.opsPerSecond)}x`;
}

function comparisonRows(results: BenchResult[]): ComparisonRow[] {
  const operations = [...new Set(results.map((result) => result.operation))];
  return operations.map((operation) => {
    const row = {
      operation,
      nodeRedis: results.find((item) => item.operation === operation && item.backend === "Node.js + Redis") ?? null,
      nodePostgres: results.find((item) => item.operation === operation && item.backend === "Node.js + PostgreSQL") ?? null,
      nodePostgresL1: results.find((item) => item.operation === operation && item.backend === "Node.js + PostgreSQL (L1)") ?? null,
      bunPostgres: results.find((item) => item.operation === operation && item.backend === "Bun.js + PostgreSQL") ?? null,
      bunPostgresL1: results.find((item) => item.operation === operation && item.backend === "Bun.js + PostgreSQL (L1)") ?? null
    };
    return row;
  });
}

function isL1ReadOperation(operation: string): boolean {
  return operation === "KV read (hot cache)" || /^KV read \(\d+% L1\)$/.test(operation);
}

function mode(result: BenchResult | null, l2: BenchResult | null): string {
  if (!result) return "-";
  return result === l2 ? "L2" : "L1";
}

function appPathSummaryRows(rows: ComparisonRow[]): string[] {
  return rows.map((row) =>
    appPathSummaryRow(row)
  );
}

function appPathSummaryRow(row: ComparisonRow): string {
  const nodeApp = row.nodePostgresL1 ?? row.nodePostgres;
  const bunApp = row.bunPostgresL1 ?? row.bunPostgres;
  return `| ${row.operation} | ${formatOps(row.nodeRedis)} | ${mode(nodeApp, row.nodePostgres)} | ${formatOps(nodeApp)} | ${formatRatio(nodeApp, row.nodeRedis)} | ${mode(bunApp, row.bunPostgres)} | ${formatOps(bunApp)} | ${formatRatio(bunApp, row.nodeRedis)} |`;
}

function l1ReadRows(rows: ComparisonRow[]): string[] {
  return rows
    .filter((row) => isL1ReadOperation(row.operation))
    .map((row) =>
      `| ${row.operation} | ${formatOps(row.nodeRedis)} | ${formatOps(row.nodePostgresL1)} | ${formatRatio(row.nodePostgresL1, row.nodeRedis)} | ${formatOps(row.bunPostgresL1)} | ${formatRatio(row.bunPostgresL1, row.nodeRedis)} |`
    );
}

function l2BackendRows(rows: ComparisonRow[]): string[] {
  return rows.map((row) =>
    `| ${row.operation} | ${formatOps(row.nodeRedis)} | ${formatOps(row.nodePostgres)} | ${formatRatio(row.nodePostgres, row.nodeRedis)} | ${formatOps(row.bunPostgres)} | ${formatRatio(row.bunPostgres, row.nodeRedis)} |`
  );
}

function markdown(results: BenchResult[]): string {
  const generatedAt = new Date().toISOString();
  const rows = comparisonRows(results);
  const details = results.map((result) =>
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
    "- The benchmark workflow runs PostgreSQL 18 with asynchronous I/O enabled via `io_method=worker`.",
    "- The workflow gives both service containers `--cpus 2 --memory 2g`.",
    "- Node.js tests run with `node`; Bun.js tests run with `bun`.",
    "- Node.js PostgreSQL uses a connection pool sized to the benchmark concurrency.",
    "- The recommended cache replacement path is L1 in-process memory backed by PostgreSQL L2 storage. L1 rows show that path; L2 rows show the direct PostgreSQL fallback/backend path.",
    "- The 99%, 95%, and 90% L1 rows intentionally mix local hits with PostgreSQL misses to model realistic cache-aside workloads.",
    "- PostgreSQL tables created by pgredis are `UNLOGGED` by default for cache-like workloads, and the workflow sets `synchronous_commit=off` for the benchmark database. Both choices trade crash-time recency guarantees for cache throughput.",
    "",
    "## Application Cache Path",
    "",
    "Ops/sec is higher-is-better. This table follows the recommended Redis replacement shape: KV reads use L1 when a matching L1 scenario exists; writes and non-cache primitives use the PostgreSQL backend path.",
    "",
    "| Operation | Redis | Node PG mode | Node PG | Node PG/Redis | Bun PG mode | Bun PG | Bun PG/Redis |",
    "| --- | ---: | --- | ---: | ---: | --- | ---: | ---: |",
    ...appPathSummaryRows(rows),
    "",
    "## L1 Read Cache",
    "",
    "These rows isolate pgredis local memory cache behavior. Mixed hit-rate rows include PostgreSQL misses and are closer to real cache-aside usage than the 100% hot-cache row.",
    "",
    "| Operation | Redis | Node PG L1 | Node PG L1/Redis | Bun PG L1 | Bun PG L1/Redis |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...l1ReadRows(rows),
    "",
    "## L2 Backend Path",
    "",
    "These rows disable pgredis L1 and measure direct PostgreSQL access. They are useful for fallback sizing and regression tracking, not as the main cache-hit comparison.",
    "",
    "| Operation | Redis | Node PG L2 | Node PG L2/Redis | Bun PG L2 | Bun PG L2/Redis |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...l2BackendRows(rows),
    "",
    "## Details",
    "",
    "| Operation | Backend | Iterations | Concurrency | Duration ms | Ops/sec |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
    ...details,
    "",
    "Notes:",
    "",
    "- Redis tests use key prefixes and do not flush the whole database.",
    "- PostgreSQL tests create temporary benchmark tables and drop them at the end.",
    "- L1 applies only to KV reads. Counter, set, and pub/sub rows are functional replacement paths over PostgreSQL, not local-cache shortcuts.",
    "- Numbers are intended for regression tracking, not universal database sizing.",
    "",
    "References behind benchmark design:",
    "",
    "- PostgreSQL `UNLOGGED` tables reduce WAL work for cache-like data, with crash-safety and replication trade-offs: https://www.postgresql.org/docs/current/sql-createtable.html",
    "- `synchronous_commit=off` can improve throughput for noncritical transactions while risking loss of recent acknowledged commits after a crash: https://www.postgresql.org/docs/current/runtime-config-wal.html",
    "- PostgreSQL pipeline mode reduces client/server round trips by sending multiple queries before reading prior results: https://www.postgresql.org/docs/current/libpq-pipeline-mode.html",
    "- PostgreSQL bulk-loading guidance favors batching, transactions, prepared statements, and COPY over many independent INSERTs: https://www.postgresql.org/docs/current/populate.html"
  ].join("\n") + "\n";
}

function readResults(raw: string): BenchResult[] {
  const parsed = JSON.parse(raw) as BenchResult[];
  if (!Array.isArray(parsed)) throw new Error("Benchmark child did not produce an array");
  return parsed;
}

function readmeSummary(results: BenchResult[]): string {
  const rows = comparisonRows(results);
  return [
    "<!-- BENCHMARK:START -->",
    "Latest benchmark summary, generated by the GitHub Actions benchmark workflow. Ops/sec is higher-is-better; ratios compare against Node.js + Redis for the same operation. KV read rows use the recommended pgredis L1+PostgreSQL path when an L1 scenario exists; writes and non-cache primitives use the PostgreSQL backend path. See [benchmark.md](./benchmark.md) for L1 hit-rate rows, L2 fallback rows, full timings, and notes.",
    "",
    "| Operation | Redis | Node PG mode | Node PG | Node PG/Redis | Bun PG mode | Bun PG | Bun PG/Redis |",
    "| --- | ---: | --- | ---: | ---: | --- | ---: | ---: |",
    ...appPathSummaryRows(rows),
    "<!-- BENCHMARK:END -->"
  ].join("\n");
}

async function updateReadme(results: BenchResult[]): Promise<void> {
  const readmeUrl = new URL("../README.md", import.meta.url);
  const start = "<!-- BENCHMARK:START -->";
  const end = "<!-- BENCHMARK:END -->";
  const current = await readFile(readmeUrl, "utf8");
  const nextBlock = readmeSummary(results);

  if (!current.includes(start) || !current.includes(end)) {
    throw new Error("README.md is missing benchmark summary markers");
  }

  const before = current.slice(0, current.indexOf(start));
  const after = current.slice(current.indexOf(end) + end.length);
  await writeFile(readmeUrl, `${before}${nextBlock}${after}`);
}

const temp = await mkdtemp(join(tmpdir(), "pgredis-benchmark-"));

try {
  const nodeOut = join(temp, "node.json");
  const bunOut = join(temp, "bun.json");
  const childEnv = {
    BENCHMARK_ITERATIONS: String(iterations),
    BENCHMARK_CONCURRENCY: String(concurrency),
    BENCHMARK_RUN_ID: runId,
    DATABASE_URL: process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5432/pgredis",
    REDIS_URL: process.env.REDIS_URL || "redis://127.0.0.1:6379"
  };

  await run("node", ["benchmark/node.mjs"], { ...childEnv, BENCHMARK_OUTPUT: nodeOut });
  await run("bun", ["benchmark/bun-postgres.mjs"], { ...childEnv, BENCHMARK_OUTPUT: bunOut });

  const results = [
    ...readResults(await readFile(nodeOut, "utf8")),
    ...readResults(await readFile(bunOut, "utf8"))
  ];
  const output = markdown(results);
  await writeFile(new URL("../benchmark.md", import.meta.url), output);
  await updateReadme(results);
  console.log(output);
} finally {
  await rm(temp, { recursive: true, force: true });
}

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

function remoteSummaryRows(rows: ComparisonRow[]): string[] {
  return rows.map((row) =>
    `| ${row.operation} | ${formatOps(row.nodeRedis)} | ${formatOps(row.nodePostgres)} | ${formatRatio(row.nodePostgres, row.nodeRedis)} | ${formatOps(row.bunPostgres)} | ${formatRatio(row.bunPostgres, row.nodeRedis)} |`
  );
}

function hotReadL1Row(rows: ComparisonRow[]): ComparisonRow | null {
  return rows.find((row) => row.operation === "KV read (hot cache)" && (row.nodePostgresL1 || row.bunPostgresL1)) ?? null;
}

function l1Note(row: ComparisonRow | null, compact = false): string {
  if (!row) return "No L1 hot-read row was generated.";
  const prefix = compact ? "L1 hot-read note:" : "For the hot-read cache case with pgredis L1 enabled:";
  return `${prefix} Node/Postgres L1 reached ${formatOps(row.nodePostgresL1)} ops/sec (${formatRatio(row.nodePostgresL1, row.nodeRedis)} vs Redis), and Bun/Postgres L1 reached ${formatOps(row.bunPostgresL1)} ops/sec (${formatRatio(row.bunPostgresL1, row.nodeRedis)} vs Redis).`;
}

function markdown(results: BenchResult[]): string {
  const generatedAt = new Date().toISOString();
  const rows = comparisonRows(results);
  const details = results.map((result) =>
    `| ${result.operation} | ${result.backend} | ${result.iterations} | ${result.concurrency} | ${formatNumber(result.durationMs)} | ${formatNumber(result.opsPerSecond)} |`
  );
  const hotL1 = hotReadL1Row(rows);

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
    "- Main comparison rows use `@postgresx/noredis` with local L1 disabled, so reads hit PostgreSQL. This compares Redis as a service with PostgreSQL as a service.",
    "- L1 is enabled only for the hot-read note and details rows, because it measures an in-process application cache rather than the PostgreSQL service itself.",
    "- PostgreSQL tables created by pgredis are `UNLOGGED` by default for cache-like workloads, and the workflow sets `synchronous_commit=off` for the benchmark database. Both choices trade crash-time recency guarantees for cache throughput.",
    "",
    "## Summary",
    "",
    "Ops/sec is higher-is-better. The main table keeps pgredis L1 disabled to avoid mixing service-level backend performance with in-process cache hits.",
    "",
    "| Operation | Node.js + Redis ops/sec | Node.js + PostgreSQL ops/sec | Node/Postgres vs Redis | Bun.js + PostgreSQL ops/sec | Bun/Postgres vs Redis |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...remoteSummaryRows(rows),
    "",
    "## L1 Hot-Read Note",
    "",
    l1Note(hotL1),
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
    "- PostgreSQL `(L1)` detail rows are informational only and are intentionally excluded from the main comparison table.",
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
  const hotL1 = hotReadL1Row(rows);

  return [
    "<!-- BENCHMARK:START -->",
    "Latest benchmark summary, generated by the GitHub Actions benchmark workflow. Ops/sec is higher-is-better; ratios compare against Node.js + Redis for the same operation. Main PostgreSQL rows keep pgredis L1 disabled so reads hit PostgreSQL. See [benchmark.md](./benchmark.md) for full timings and notes.",
    "",
    "| Operation | Redis ops/sec | Node/Postgres ops/sec | Node/Postgres vs Redis | Bun/Postgres ops/sec | Bun/Postgres vs Redis |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...remoteSummaryRows(rows),
    "",
    l1Note(hotL1, true),
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

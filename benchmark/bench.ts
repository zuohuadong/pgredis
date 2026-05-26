import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

interface BenchResult {
  operation: string;
  backend: "Node.js + Redis" | "Node.js + PostgreSQL" | "Bun.js + PostgreSQL";
  iterations: number;
  concurrency: number;
  durationMs: number;
  opsPerSecond: number;
}

interface ComparisonRow {
  operation: string;
  nodeRedis: BenchResult | null;
  nodePostgres: BenchResult | null;
  bunPostgres: BenchResult | null;
  fastest: BenchResult | null;
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
      bunPostgres: results.find((item) => item.operation === operation && item.backend === "Bun.js + PostgreSQL") ?? null,
      fastest: null as BenchResult | null
    };
    row.fastest = [row.nodeRedis, row.nodePostgres, row.bunPostgres]
      .filter((item): item is BenchResult => item !== null)
      .sort((a, b) => b.opsPerSecond - a.opsPerSecond)[0] ?? null;
    return row;
  });
}

function markdown(results: BenchResult[]): string {
  const generatedAt = new Date().toISOString();
  const rows = comparisonRows(results);
  const comparison = rows.map((row) =>
    `| ${row.operation} | ${formatOps(row.nodeRedis)} | ${formatOps(row.nodePostgres)} | ${formatRatio(row.nodePostgres, row.nodeRedis)} | ${formatOps(row.bunPostgres)} | ${formatRatio(row.bunPostgres, row.nodeRedis)} | ${row.fastest?.backend ?? "-"} |`
  );
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
    "- The workflow constrains both service containers to `--cpus 1 --memory 512m`.",
    "- Node.js tests run with `node`; Bun.js tests run with `bun`.",
    "- PostgreSQL tests use `@postgresx/noredis` with the local L1 cache disabled so reads hit PostgreSQL.",
    "",
    "## Summary",
    "",
    "Ops/sec is higher-is-better. Ratios compare each PostgreSQL backend against the Node.js + Redis baseline for the same operation.",
    "",
    "| Operation | Node.js + Redis ops/sec | Node.js + PostgreSQL ops/sec | Node/Postgres vs Redis | Bun.js + PostgreSQL ops/sec | Bun/Postgres vs Redis | Fastest |",
    "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ...comparison,
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
    "- Numbers are intended for regression tracking, not universal database sizing."
  ].join("\n") + "\n";
}

function readResults(raw: string): BenchResult[] {
  const parsed = JSON.parse(raw) as BenchResult[];
  if (!Array.isArray(parsed)) throw new Error("Benchmark child did not produce an array");
  return parsed;
}

function readmeSummary(results: BenchResult[]): string {
  const rows = comparisonRows(results).map((row) =>
    `| ${row.operation} | ${formatOps(row.nodeRedis)} | ${formatOps(row.nodePostgres)} | ${formatRatio(row.nodePostgres, row.nodeRedis)} | ${formatOps(row.bunPostgres)} | ${formatRatio(row.bunPostgres, row.nodeRedis)} | ${row.fastest?.backend ?? "-"} |`
  );

  return [
    "<!-- BENCHMARK:START -->",
    "Latest benchmark summary, generated by the manual GitHub Actions benchmark workflow. Ops/sec is higher-is-better; ratios compare against Node.js + Redis for the same operation. See [benchmark.md](./benchmark.md) for full timings and notes.",
    "",
    "| Operation | Node.js + Redis ops/sec | Node.js + PostgreSQL ops/sec | Node/Postgres vs Redis | Bun.js + PostgreSQL ops/sec | Bun/Postgres vs Redis | Fastest |",
    "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ...rows,
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

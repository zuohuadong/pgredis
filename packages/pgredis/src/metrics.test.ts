import { describe, expect, test } from "bun:test";
import { collectPgredisMetrics } from "./metrics";
import type { PgSqlLike } from "./sql";

class MetricsSql implements PgSqlLike {
  readonly queries: Array<{ query: string; params: readonly unknown[] }> = [];

  async unsafe<T = Record<string, unknown>>(query: string, params: readonly unknown[] = []): Promise<T[]> {
    this.queries.push({ query, params });
    const normalized = query.replace(/\s+/g, " ").trim().toUpperCase();

    if (normalized.includes("PG_STAT_USER_TABLES")) {
      return [{
        relname: "pgredis_kv",
        total_bytes: 8192,
        n_live_tup: 100,
        n_dead_tup: 5,
        last_vacuum: null,
        last_autovacuum: null
      }] as T[];
    }

    if (normalized.includes("EXPIRES_AT IS NOT NULL AND EXPIRES_AT <= NOW()")) {
      return [{ count: 3 }] as T[];
    }

    return [] as T[];
  }
}

describe("collectPgredisMetrics", () => {
  test("collects table metrics from pg_stat_user_tables", async () => {
    const sql = new MetricsSql();
    const result = await collectPgredisMetrics({ sql, namespace: "app" });

    expect(result.namespace).toBe("app");
    expect(result.tables).toHaveLength(1);
    expect(result.tables[0]).toMatchObject({
      tableName: "pgredis_kv",
      totalBytes: 8192,
      liveRows: 100,
      deadRows: 5,
      lastVacuum: null,
      lastAutovacuum: null,
      ttlBacklog: 3
    });
  });

  test("includes cleanup metrics when provided", async () => {
    const sql = new MetricsSql();
    const cleanup = { totalDeleted: 42, lastDeleted: 10, lastRunAt: new Date() };
    const result = await collectPgredisMetrics({ sql, cleanup });

    expect(result.cleanup).toEqual(cleanup);
  });

  test("uses custom table names when provided", async () => {
    const sql = new MetricsSql();
    await collectPgredisMetrics({ sql, tableNames: ["custom_table"] });

    expect(sql.queries[0]!.params[0]).toContain("custom_table");
  });
});

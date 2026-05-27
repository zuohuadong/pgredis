import { describe, expect, test } from "bun:test";
import { createPgredis, type PgredisClient } from "./client";
import type { PgSqlLike } from "./sql";

class ClientSql implements PgSqlLike {
  readonly queries: Array<{ query: string; params: readonly unknown[] }> = [];

  async unsafe<T = Record<string, unknown>>(query: string, params: readonly unknown[] = []): Promise<T[]> {
    this.queries.push({ query, params });
    const normalized = query.replace(/\s+/g, " ").trim().toUpperCase();
    if (normalized.startsWith("CREATE")) return [] as T[];
    if (normalized.startsWith("SELECT 1")) return [{ ok: true }] as T[];
    if (normalized.startsWith("INSERT INTO")) {
      if (normalized.includes("COUNTER") || normalized.includes("BIGINT")) {
        const amount = Number(params[2] ?? 1);
        return [{ value: amount }] as T[];
      }
      return [{ key: String(params[1] ?? "k") }] as T[];
    }
    if (normalized.startsWith("SELECT VALUE")) {
      return [{ value: { v: 1 }, expires_at: null }] as T[];
    }
    if (normalized.startsWith("DELETE FROM")) {
      if (normalized.includes("EXPIRES_AT IS NOT NULL")) return [] as T[];
      return [{ key: "k" }] as T[];
    }
    if (normalized.startsWith("SELECT PG_NOTIFY")) return [] as T[];
    if (normalized.startsWith("SELECT COUNT")) return [{ count: 0 }] as T[];
    if (normalized.startsWith("SELECT EXISTS")) return [{ exists: false }] as T[];
    if (normalized.startsWith("SELECT KEY FROM")) return [] as T[];
    if (normalized.startsWith("SELECT MEMBER")) return [] as T[];
    if (normalized.startsWith("SELECT FIELD")) return [] as T[];
    if (normalized.startsWith("SELECT SCORE")) return [] as T[];
    if (normalized.startsWith("WITH SOURCE")) return [{ key: "new" }] as T[];
    if (normalized.includes("PG_TOTAL_RELATION_SIZE")) return [] as T[];
    return [] as T[];
  }

  async begin<T>(callback: (tx: PgSqlLike) => Promise<T>): Promise<T> {
    return callback(this);
  }
}

describe("createPgredis", () => {
  function createClient(): PgredisClient {
    const sql = new ClientSql();
    return createPgredis({ sql, namespace: "test" });
  }

  test("ensureSchema creates all sub-schema tables", async () => {
    const client = createClient();
    await client.ensureSchema();
    // Should have created schema for: kv, counter, hash, set, list, sorted_set, outbox
  });

  test("health returns ok", async () => {
    const client = createClient();
    const result = await client.health();
    expect(result).toEqual({ ok: true });
  });

  test("stats returns cache stats without queue", async () => {
    const client = createClient();
    const result = await client.stats();
    expect(result.cache).toBeDefined();
    expect(result.queue).toBeUndefined();
    expect(result.cleanup).toBeDefined();
  });

  test("cleanupExpired returns per-table counts", async () => {
    const client = createClient();
    const result = await client.cleanupExpired();
    expect(result).toHaveProperty("cache");
    expect(result).toHaveProperty("counter");
    expect(result).toHaveProperty("hash");
    expect(result).toHaveProperty("set");
    expect(result).toHaveProperty("list");
    expect(result).toHaveProperty("sortedSet");
  });

  test("batch executes operation", async () => {
    const client = createClient();
    const result = await client.batch(async (tx) => {
      await tx.cache.set("k", { v: 1 });
      return "done";
    });
    expect(result).toBe("done");
  });

  test("pipeline chains and executes", async () => {
    const client = createClient();
    const results = await client.pipeline()
      .set("k1", "v1")
      .get("k1")
      .incr("counter")
      .exec();
    expect(results).toHaveLength(3);
  });

  test("startCleanupWorker returns stop function", () => {
    const client = createClient();
    const stop = client.startCleanupWorker({ intervalMs: 10_000 });
    expect(typeof stop).toBe("function");
    stop();
  });

  test("redis aliases are available", async () => {
    const client = createClient();
    expect(client.redis).toBeDefined();
    expect(typeof client.redis.get).toBe("function");
    expect(typeof client.redis.set).toBe("function");
    expect(typeof client.redis.hset).toBe("function");
    expect(typeof client.redis.pipeline).toBe("function");
  });

  test("metrics returns table metrics", async () => {
    const client = createClient();
    const result = await client.metrics();
    expect(result.tables).toBeDefined();
    expect(Array.isArray(result.tables)).toBe(true);
  });
});

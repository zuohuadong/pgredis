import { describe, expect, test } from "bun:test";
import { PgKvCache, type BunSqlLike, type PgKvNotification } from "./kv-cache";

interface StoredValue {
  value: unknown;
  expiresAt: number | null;
}

class MockSql implements BunSqlLike {
  now = 1_000;
  readonly rows = new Map<string, StoredValue>();
  readonly queries: Array<{ query: string; params: readonly unknown[] }> = [];
  readonly notifications: PgKvNotification[] = [];

  async unsafe<T = Record<string, unknown>>(query: string, params: readonly unknown[] = []): Promise<T[]> {
    this.queries.push({ query, params });
    const normalized = query.replace(/\s+/g, " ").trim().toUpperCase();

    if (normalized.startsWith("CREATE")) return [] as T[];

    if (normalized.startsWith("SELECT PG_NOTIFY")) {
      this.notifications.push(JSON.parse(String(params[1])) as PgKvNotification);
      return [] as T[];
    }

    if (normalized.startsWith("INSERT INTO")) {
      // NX mode: ON CONFLICT ... WHERE expired - skip if row exists and is not expired
      if (normalized.includes("EXPIRES_AT IS NOT NULL") && normalized.includes("EXPIRES_AT <=")) {
        const namespace = String(params[0]);
        const key = String(params[1]);
        const existing = this.getLiveRow(namespace, key);
        if (existing) return [] as T[];
      }
      for (let index = 0; index < params.length; index += 4) {
        const namespace = String(params[index]);
        const key = String(params[index + 1]);
        const value = JSON.parse(String(params[index + 2])) as unknown;
        const ttlMs = params[index + 3] === null ? null : Number(params[index + 3]);
        this.rows.set(this.rowKey(namespace, key), {
          value,
          expiresAt: ttlMs === null ? null : this.now + ttlMs
        });
      }
      return [{ key: String(params[1]) }] as T[];
    }

    if (normalized.startsWith("UPDATE")) {
      const namespace = String(params[0]);
      const key = String(params[1]);
      const compoundKey = this.rowKey(namespace, key);
      const row = this.getLiveRow(namespace, key);
      if (!row) return [] as T[];

      if (normalized.includes("VALUE = $3::JSONB") || normalized.includes("VALUE = $4::JSONB")) {
        const valueParam = normalized.includes("VALUE = $3::JSONB") ? 2 : 3;
        const ttlParam = normalized.includes("VALUE = $3::JSONB") ? 3 : 4;
        const expectedParam = normalized.includes("VALUE = $4::JSONB") ? 2 : null;
        if (expectedParam !== null && JSON.stringify(row.value) !== String(params[expectedParam])) return [] as T[];
        const ttlMs = params[ttlParam] === null ? null : Number(params[ttlParam]);
        const value = JSON.parse(String(params[valueParam])) as unknown;
        this.rows.set(compoundKey, {
          value,
          expiresAt: ttlMs === null ? null : this.now + ttlMs
        });
        return [{ key, value, expires_at: this.toDate(ttlMs === null ? null : this.now + ttlMs) }] as T[];
      }

      if (normalized.includes("EXPIRES_AT = NOW()")) {
        const ttlMs = Number(params[2]);
        row.expiresAt = this.now + ttlMs;
        return [{ key, value: row.value, expires_at: this.toDate(row.expiresAt) }] as T[];
      }

      if (normalized.includes("EXPIRES_AT = NULL")) {
        row.expiresAt = null;
        return [{ key, value: row.value, expires_at: null }] as T[];
      }

      return [{ key }] as T[];
    }

    if (normalized.startsWith("SELECT VALUE")) {
      const namespace = String(params[0]);
      const key = String(params[1]);
      const row = this.getLiveRow(namespace, key);
      return (row ? [{ value: row.value, expires_at: this.toDate(row.expiresAt) }] : []) as T[];
    }

    if (normalized.startsWith("SELECT KEY, VALUE")) {
      const namespace = String(params[0]);
      const keys = params.slice(1).map(String);
      return keys.flatMap((key) => {
        const row = this.getLiveRow(namespace, key);
        return row ? [{ key, value: row.value, expires_at: this.toDate(row.expiresAt) }] : [];
      }) as T[];
    }

    if (normalized.startsWith("SELECT KEY FROM")) {
      const namespace = String(params[0]);
      const pattern = this.likePatternToRegExp(String(params[1]));
      const cursor = params.length > 3 ? String(params[2] ?? "") : "";
      const limit = Number(params[params.length - 1] ?? 1000);
      const rows = Array.from(this.rows.keys())
        .flatMap((compoundKey) => {
          const [rowNamespace, key] = compoundKey.split("\0");
          const row = this.getLiveRow(rowNamespace!, key!);
          return rowNamespace === namespace && row && pattern.test(key!) && key! > cursor ? [key!] : [];
        })
        .sort()
        .slice(0, limit)
        .map((key) => ({ key }));
      return rows as T[];
    }

    if (normalized.startsWith("WITH SOURCE")) {
      const namespace = String(params[0]);
      const key = String(params[1]);
      const newKey = String(params[2]);
      const row = this.getLiveRow(namespace, key);
      if (!row) return [] as T[];
      this.rows.delete(this.rowKey(namespace, newKey));
      this.rows.delete(this.rowKey(namespace, key));
      this.rows.set(this.rowKey(namespace, newKey), row);
      return [{ key: newKey }] as T[];
    }

    if (normalized.startsWith("DELETE FROM") && normalized.includes("EXPIRES_AT IS NOT NULL")) {
      const deleted: Array<{ namespace: string; key: string }> = [];
      for (const [compoundKey, row] of this.rows.entries()) {
        if (row.expiresAt !== null && row.expiresAt <= this.now) {
          const [namespace, key] = compoundKey.split("\0");
          this.rows.delete(compoundKey);
          deleted.push({ namespace: namespace!, key: key! });
        }
      }
      return deleted as T[];
    }

    if (normalized.startsWith("DELETE FROM") && normalized.includes("KEY LIKE")) {
      const namespace = String(params[0]);
      const prefix = String(params[1]).replace(/%$/, "").replace(/\\/g, "");
      const deleted: Array<{ key: string }> = [];
      for (const compoundKey of Array.from(this.rows.keys())) {
        const [rowNamespace, key] = compoundKey.split("\0");
        if (rowNamespace === namespace && key!.startsWith(prefix)) {
          this.rows.delete(compoundKey);
          deleted.push({ key: key! });
        }
      }
      return deleted as T[];
    }

    if (normalized.startsWith("DELETE FROM") && normalized.includes("KEY IN")) {
      const namespace = String(params[0]);
      const keys = params.slice(1).map(String);
      const deleted: Array<{ key: string }> = [];
      for (const key of keys) {
        if (this.rows.delete(this.rowKey(namespace, key))) deleted.push({ key });
      }
      return deleted as T[];
    }

    if (normalized.startsWith("DELETE FROM") && normalized.includes("AND KEY =")) {
      const namespace = String(params[0]);
      const key = String(params[1]);
      const deleted = this.rows.delete(this.rowKey(namespace, key));
      return (deleted ? [{ key }] : []) as T[];
    }

    if (normalized.startsWith("DELETE FROM") && normalized.includes("WHERE NAMESPACE =")) {
      const namespace = String(params[0]);
      const deleted: Array<{ key: string }> = [];
      for (const compoundKey of Array.from(this.rows.keys())) {
        const [rowNamespace, key] = compoundKey.split("\0");
        if (rowNamespace === namespace) {
          this.rows.delete(compoundKey);
          deleted.push({ key: key! });
        }
      }
      return deleted as T[];
    }

    throw new Error(`Unhandled SQL: ${query}`);
  }

  private rowKey(namespace: string, key: string): string {
    return `${namespace}\0${key}`;
  }

  private getLiveRow(namespace: string, key: string): StoredValue | null {
    const row = this.rows.get(this.rowKey(namespace, key));
    if (!row) return null;
    if (row.expiresAt !== null && row.expiresAt <= this.now) return null;
    return row;
  }

  private toDate(expiresAt: number | null): Date | null {
    return expiresAt === null ? null : new Date(expiresAt);
  }

  private likePatternToRegExp(pattern: string): RegExp {
    let source = "^";
    for (let index = 0; index < pattern.length; index++) {
      const char = pattern[index]!;
      if (char === "\\") {
        source += this.escapeRegExp(pattern[++index] ?? "");
      } else if (char === "%") {
        source += ".*";
      } else if (char === "_") {
        source += ".";
      } else {
        source += this.escapeRegExp(char);
      }
    }
    return new RegExp(`${source}$`);
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}

describe("PgKvCache", () => {
  test("creates an unlogged schema with ttl and prefix indexes", async () => {
    const sql = new MockSql();
    const cache = new PgKvCache({ sql, tableName: "public.pg_kv_cache" });

    await cache.ensureSchema();

    expect(sql.queries).toHaveLength(3);
    expect(sql.queries[0]!.query).toContain("CREATE UNLOGGED TABLE");
    expect(sql.queries[1]!.query).toContain("expires_at");
    expect(sql.queries[2]!.query).toContain("text_pattern_ops");
  });

  test("serves fresh values from L1 without reading Postgres again", async () => {
    const sql = new MockSql();
    const cache = new PgKvCache({ sql, namespace: "auth", instanceId: "local" });

    await cache.set("token-a", { userId: 1 }, { ttlMs: 60_000 });
    const queryCountAfterSet = sql.queries.length;
    const value = await cache.get<{ userId: number }>("token-a");

    expect(value).toEqual({ userId: 1 });
    expect(sql.queries).toHaveLength(queryCountAfterSet);
    expect(sql.notifications[0]).toMatchObject({ namespace: "auth", key: "token-a", op: "set" });
  });

  test("falls back to Postgres after L1 ttl expires", async () => {
    const sql = new MockSql();
    const cache = new PgKvCache({ sql, namespace: "auth", l1: { ttlMs: 10 }, now: () => sql.now });

    await cache.set("token-b", { userId: 2 }, { ttlMs: 1_000 });
    sql.now += 20;

    const value = await cache.get<{ userId: number }>("token-b");

    expect(value).toEqual({ userId: 2 });
    expect(sql.queries.some((entry) => entry.query.includes("SELECT value"))).toBe(true);
  });

  test("returns null for expired L2 rows", async () => {
    const sql = new MockSql();
    const cache = new PgKvCache({ sql, namespace: "auth", l1: false, now: () => sql.now });

    await cache.set("token-c", { userId: 3 }, { ttlMs: 5 });
    sql.now += 10;

    await expect(cache.get("token-c")).resolves.toBeNull();
  });

  test("supports mset, mget and prefix clearing", async () => {
    const sql = new MockSql();
    const cache = new PgKvCache({ sql, namespace: "models" });

    await cache.mset([
      ["channel:a", { id: 1 }],
      ["channel:b", { id: 2 }],
      ["option:c", { id: 3 }]
    ]);

    const values = await cache.mget<{ id: number }>(["channel:a", "channel:b", "missing"]);
    expect(values.get("channel:a")).toEqual({ id: 1 });
    expect(values.get("channel:b")).toEqual({ id: 2 });
    expect(values.has("missing")).toBe(false);

    await expect(cache.clearPrefix("channel:")).resolves.toBe(2);
    await expect(cache.get("channel:a")).resolves.toBeNull();
    await expect(cache.get("option:c")).resolves.toEqual({ id: 3 });
  });

  test("supports Redis-style key globbing and cursor scans", async () => {
    const sql = new MockSql();
    const cache = new PgKvCache({ sql, namespace: "models", l1: false });

    await cache.mset([
      ["user:1", { id: 1 }],
      ["user:2", { id: 2 }],
      ["session:1", { id: 3 }]
    ]);

    await expect(cache.keys("user:*")).resolves.toEqual(["user:1", "user:2"]);
    await expect(cache.keys("*:1")).resolves.toEqual(["session:1", "user:1"]);

    const first = await cache.scan(null, 1, "user:*");
    expect(first).toEqual({ cursor: "user:1", keys: ["user:1"] });
    await expect(cache.scan(first.cursor, 10, "user:*")).resolves.toEqual({ cursor: null, keys: ["user:2"] });
  });

  test("rename overwrites the destination key", async () => {
    const sql = new MockSql();
    const cache = new PgKvCache({ sql, namespace: "models", l1: false });

    await cache.set("old", { id: 1 });
    await cache.set("new", { id: 2 });

    await expect(cache.rename("old", "new")).resolves.toBe(true);
    await expect(cache.get("old")).resolves.toBeNull();
    await expect(cache.get("new")).resolves.toEqual({ id: 1 });
    await expect(cache.rename("missing", "newer")).resolves.toBe(false);
  });

  test("applies remote invalidation and ignores self notifications", async () => {
    const sql = new MockSql();
    const cache = new PgKvCache({ sql, namespace: "auth", instanceId: "local" });

    await cache.set("token-d", { userId: 4 });
    expect(cache.stats().l1Size).toBe(1);

    expect(cache.handleNotification({
      namespace: "auth",
      key: "token-d",
      op: "delete",
      senderId: "remote"
    })).toBe(true);
    expect(cache.stats().l1Size).toBe(0);

    await cache.set("token-d", { userId: 4 });
    expect(cache.handleNotification({
      namespace: "auth",
      key: "token-d",
      op: "delete",
      senderId: "local"
    })).toBe(false);
    expect(cache.stats().l1Size).toBe(1);
  });
});

  test("NX: set only when key is missing", async () => {
    const sql = new MockSql();
    const cache = new PgKvCache({ sql, namespace: "nx" });

    await cache.set("existing", { v: 1 }, { ttlMs: 60_000 });
    // NX on existing key should not overwrite
    const written = await cache.set("existing", { v: 2 }, { nx: true });
    expect(written).toBe(false);
    const val = await cache.get("existing");
    expect(val).toEqual({ v: 1 });
  });

  test("XX: set only when key exists", async () => {
    const sql = new MockSql();
    const cache = new PgKvCache({ sql, namespace: "xx" });

    // XX on missing key
    const miss = await cache.set("missing", { v: 1 }, { xx: true });
    expect(miss).toBe(false);

    await cache.set("present", { v: 1 }, { ttlMs: 60_000 });
    const hit = await cache.set("present", { v: 2 }, { xx: true });
    expect(hit).toBe(true);
  });

  test("NX and XX together throws", async () => {
    const sql = new MockSql();
    const cache = new PgKvCache({ sql, namespace: "both" });
    await expect(cache.set("k", { v: 1 }, { nx: true, xx: true })).rejects.toThrow("nx and xx");
  });

  test("compareAndSwap replaces only when expected matches", async () => {
    const sql = new MockSql();
    const cache = new PgKvCache({ sql, namespace: "cas" });

    await cache.set("counter", 1, { ttlMs: 60_000 });
    // CAS with wrong expected value
    const miss = await cache.compareAndSwap("counter", 999, 2);
    expect(miss).toBe(false);

    // CAS with correct expected value
    const hit = await cache.compareAndSwap("counter", 1, 2);
    expect(hit).toBe(true);
    const val = await cache.get("counter");
    expect(val).toBe(2);
  });

  test("compareAndSwap handles missing key with expectedMissing", async () => {
    const sql = new MockSql();
    const cache = new PgKvCache({ sql, namespace: "cas-miss" });

    const hit = await cache.compareAndSwap("new-key", null, { v: 1 }, { expectedMissing: true });
    expect(hit).toBe(true);
  });

  test("touch returns true for existing key, false for missing", async () => {
    const sql = new MockSql();
    const cache = new PgKvCache({ sql, namespace: "touch" });

    expect(await cache.touch("missing")).toBe(false);
    await cache.set("present", { v: 1 }, { ttlMs: 60_000 });
    expect(await cache.touch("present")).toBe(true);
  });

  test("expire updates TTL on existing key", async () => {
    const sql = new MockSql();
    const cache = new PgKvCache({ sql, namespace: "ttl" });

    await cache.set("k", { v: 1 }, { ttlMs: 60_000 });
    const result = await cache.expire("k", 120_000);
    expect(result).toBe(true);
    const miss = await cache.expire("missing", 120_000);
    expect(miss).toBe(false);
  });

  test("persist removes TTL", async () => {
    const sql = new MockSql();
    const cache = new PgKvCache({ sql, namespace: "persist" });

    await cache.set("k", { v: 1 }, { ttlMs: 60_000 });
    const result = await cache.persist("k");
    expect(result).toBe(true);
  });

  test("unlink removes multiple keys", async () => {
    const sql = new MockSql();
    const cache = new PgKvCache({ sql, namespace: "unlink" });

    await cache.mset([["a", 1], ["b", 2], ["c", 3]]);
    const count = await cache.unlink("a", "b");
    expect(count).toBe(2);
  });

  test("setex/psetex/setnx/getset/getdel work", async () => {
    const sql = new MockSql();
    const cache = new PgKvCache({ sql, namespace: "shortcuts" });

    expect(await cache.setex("k1", 60, "v1")).toBe("OK");
    expect(await cache.psetex("k2", 60000, "v2")).toBe("OK");
    expect(await cache.setnx("k3", "v3")).toBe(1);
    const old = await cache.getset("k1", "new");
    expect(old).toBe("v1");
    const deleted = await cache.getdel("k1");
    expect(deleted).toBe("new");
  });

  test("delete returns boolean", async () => {
    const sql = new MockSql();
    const cache = new PgKvCache({ sql, namespace: "del" });

    await cache.set("k", { v: 1 }, { ttlMs: 60_000 });
    expect(await cache.delete("k")).toBe(true);
    expect(await cache.delete("k")).toBe(false);
  });

  test("cleanupExpired removes expired rows", async () => {
    const sql = new MockSql();
    const cache = new PgKvCache({ sql, namespace: "cleanup", l1: false, now: () => sql.now });

    await cache.set("short-lived", { v: 1 }, { ttlMs: 5 });
    sql.now += 10;
    const deleted = await cache.cleanupExpired();
    expect(deleted).toBe(1);
  });

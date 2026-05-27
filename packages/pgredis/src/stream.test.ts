import { describe, expect, test } from "bun:test";
import { PgOutboxStream, type PgOutboxMessage } from "./stream";
import type { PgSqlLike } from "./sql";

class StreamSql implements PgSqlLike {
  nextId = 0;
  readonly rows: Array<Record<string, unknown>> = [];
  readonly queries: Array<{ query: string; params: readonly unknown[] }> = [];

  private autoId(): string { return String(++this.nextId); }

  async unsafe<T = Record<string, unknown>>(query: string, params: readonly unknown[] = []): Promise<T[]> {
    this.queries.push({ query, params });
    const normalized = query.replace(/\s+/g, " ").trim().toUpperCase();

    if (normalized.startsWith("CREATE")) return [] as T[];

    if (normalized.includes("INSERT INTO") && normalized.includes("RETURNING ID")) {
      const id = this.autoId();
      const row: Record<string, unknown> = {
        id,
        stream: String(params[1]),
        payload: params[2],
        consumer: null,
        delivery_count: 0,
        available_at: new Date(),
        locked_until: null,
        processed_at: null,
        created_at: new Date()
      };
      this.rows.push(row);
      return [{ id }] as T[];
    }

    if (normalized.includes("SELECT ID, STREAM, PAYLOAD") && !normalized.includes("FOR UPDATE")) {
      const stream = String(params[1]);
      const afterId = Number(params[2] ?? 0);
      const limit = Number(params[3] ?? 100);
      const includeProcessed = params[4] === true;
      return this.rows
        .filter((r) => r.stream === stream && Number(r.id) > afterId && (includeProcessed || r.processed_at === null))
        .slice(0, limit) as T[];
    }

    if (normalized.includes("FOR UPDATE SKIP LOCKED")) {
      const stream = String(params[1]);
      const consumer = String(params[2]);
      const limit = Number(params[3] ?? 1);
      const visMs = Number(params[4] ?? 30_000);
      const matched = this.rows
        .filter((r) => r.stream === stream && r.processed_at === null && (r.locked_until === null))
        .slice(0, limit);
      for (const r of matched) {
        r.consumer = consumer;
        r.delivery_count = Number(r.delivery_count ?? 0) + 1;
        r.locked_until = new Date(Date.now() + visMs);
      }
      return matched as T[];
    }

    if (normalized.includes("SET PROCESSED_AT = NOW()") && normalized.includes("ID = ANY")) {
      const ids = (params[1] as string[]).map(Number);
      const acked = this.rows.filter((r) => ids.includes(Number(r.id)) && r.processed_at === null);
      for (const r of acked) {
        r.processed_at = new Date();
        r.locked_until = null;
      }
      return acked as T[];
    }

    if (normalized.includes("COUNT(*) FILTER")) {
      const pending = this.rows.filter((r) => r.processed_at === null).length;
      const locked = this.rows.filter((r) => r.processed_at === null && r.locked_until !== null).length;
      return [{ pending, locked }] as T[];
    }

    if (normalized.includes("DELETE FROM") && normalized.includes("PROCESSED_AT IS NOT NULL")) {
      const before = this.rows.length;
      for (let i = this.rows.length - 1; i >= 0; i--) {
        if (this.rows[i]!.processed_at !== null) this.rows.splice(i, 1);
      }
      const deleted = before - this.rows.length;
      return Array.from({ length: deleted }, () => ({ id: "x" })) as T[];
    }

    return [] as T[];
  }
}

describe("PgOutboxStream", () => {
  test("ensureSchema issues DDL queries", async () => {
    const sql = new StreamSql();
    const stream = new PgOutboxStream({ sql, namespace: "app" });
    await stream.ensureSchema();
    expect(sql.queries.length).toBeGreaterThanOrEqual(3);
    expect(sql.queries[0]!.query).toContain("CREATE");
  });

  test("append returns id and stores message", async () => {
    const sql = new StreamSql();
    const stream = new PgOutboxStream({ sql, namespace: "app" });
    const id = await stream.append("billing.events", { invoiceId: "inv_1" });
    expect(id).toBe("1");
    expect(sql.rows).toHaveLength(1);
    expect(sql.rows[0]!.stream).toBe("billing.events");
  });

  test("xadd delegates to append", async () => {
    const sql = new StreamSql();
    const stream = new PgOutboxStream({ sql, namespace: "app" });
    const id = await stream.xadd("orders", { orderId: "o1" });
    expect(id).toBe("1");
  });

  test("read returns messages ordered by id", async () => {
    const sql = new StreamSql();
    const stream = new PgOutboxStream({ sql, namespace: "app" });
    await stream.append("s1", { n: 1 });
    await stream.append("s1", { n: 2 });
    const msgs = await stream.read<{ n: number }>("s1");
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.payload).toEqual({ n: 1 });
  });

  test("read respects afterId and limit", async () => {
    const sql = new StreamSql();
    const stream = new PgOutboxStream({ sql, namespace: "app" });
    await stream.append("s1", { n: 1 });
    await stream.append("s1", { n: 2 });
    await stream.append("s1", { n: 3 });
    const msgs = await stream.read("s1", { afterId: 1, limit: 1 });
    expect(msgs).toHaveLength(1);
  });

  test("claim assigns consumer and increments delivery count", async () => {
    const sql = new StreamSql();
    const stream = new PgOutboxStream({ sql, namespace: "app" });
    await stream.append("jobs", { task: "a" });
    const claimed = await stream.claim("jobs", "worker-1");
    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.consumer).toBe("worker-1");
    expect(claimed[0]!.deliveryCount).toBe(1);
  });

  test("ack marks messages as processed", async () => {
    const sql = new StreamSql();
    const stream = new PgOutboxStream({ sql, namespace: "app" });
    await stream.append("jobs", { task: "a" });
    const acked = await stream.ack(["1"]);
    expect(acked).toBe(1);
    expect(sql.rows[0]!.processed_at).toBeTruthy();
  });

  test("ack with empty ids returns 0", async () => {
    const sql = new StreamSql();
    const stream = new PgOutboxStream({ sql, namespace: "app" });
    const acked = await stream.ack([]);
    expect(acked).toBe(0);
  });

  test("pending returns pending and locked counts", async () => {
    const sql = new StreamSql();
    const stream = new PgOutboxStream({ sql, namespace: "app" });
    await stream.append("s1", { n: 1 });
    await stream.append("s1", { n: 2 });
    await stream.claim("s1", "w1", { limit: 1 });
    const result = await stream.pending("s1");
    expect(result.pending).toBe(2);
    expect(result.locked).toBe(1);
  });

  test("trim removes processed messages", async () => {
    const sql = new StreamSql();
    const stream = new PgOutboxStream({ sql, namespace: "app" });
    await stream.append("s1", { n: 1 });
    await stream.ack(["1"]);
    const trimmed = await stream.trim({ stream: "s1" });
    expect(trimmed).toBe(1);
    expect(sql.rows).toHaveLength(0);
  });
});

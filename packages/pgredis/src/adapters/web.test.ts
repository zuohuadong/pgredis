import { describe, expect, test } from "bun:test";
import { createPgredisCacheHelpers, createPgredisSessionStore } from "./web";
import type { PgKvSetOptions } from "../kv-cache";

class MemoryCache {
  readonly values = new Map<string, unknown>();
  readonly ttls = new Map<string, number | null | undefined>();
  touched: string | null = null;

  async get<T = unknown>(key: string): Promise<T | null> {
    return this.values.has(key) ? this.values.get(key) as T : null;
  }

  async set<T = unknown>(key: string, value: T, options: PgKvSetOptions = {}): Promise<boolean> {
    this.values.set(key, value);
    this.ttls.set(key, options.ttlMs);
    return true;
  }

  async delete(key: string): Promise<boolean> {
    return this.values.delete(key);
  }

  async touch(key: string): Promise<boolean> {
    this.touched = key;
    return this.values.has(key);
  }

  async expire(key: string, ttlMs: number): Promise<boolean> {
    this.ttls.set(key, ttlMs);
    return this.values.has(key);
  }
}

describe("web adapters", () => {
  test("creates callback-compatible session stores without framework dependencies", async () => {
    const cache = new MemoryCache();
    const store = createPgredisSessionStore(cache as never, { prefix: "session:", ttlMs: 60_000 });

    await (store.set("abc", { userId: 1 }) as Promise<void>);
    await expect(store.get("abc") as Promise<unknown>).resolves.toEqual({ userId: 1 });
    await (store.touch("abc", {}) as Promise<void>);

    expect(cache.ttls.get("session:abc")).toBe(60_000);
    await expect(store.destroy("abc") as Promise<void>).resolves.toBeUndefined();
    await expect(store.get("abc") as Promise<unknown>).resolves.toBeNull();
  });

  test("wraps common cache read-through helpers", async () => {
    const cache = new MemoryCache();
    const helpers = createPgredisCacheHelpers(cache as never, { prefix: "cache:", ttlMs: 1000 });

    await expect(helpers.wrap("user:1", () => ({ id: 1 }))).resolves.toEqual({ id: 1 });
    await expect(helpers.wrap("user:1", () => ({ id: 2 }))).resolves.toEqual({ id: 1 });
    expect(cache.ttls.get("cache:user:1")).toBe(1000);
  });
});

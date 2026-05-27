import { describe, expect, test } from "bun:test";
import { createIoredisAdapter, type IoredisLikeAdapter } from "./ioredis";
import { UnsupportedCommandError } from "../errors";

function createMockClient(): any {
  return {
    cache: {
      get: async () => "val",
      set: async () => true,
      delete: async () => true,
      mget: async (keys: readonly string[]) => {
        const m = new Map<string, unknown>();
        keys.forEach((k) => m.set(k, `val:${k}`));
        return m;
      },
      mset: async () => {},
      expire: async () => true,
      ttl: async () => 5000,
      persist: async () => true,
      type: async () => "string" as const,
      unlink: async (..._keys: string[]) => 2,
      setex: async () => "OK" as const,
      psetex: async () => "OK" as const,
      setnx: async () => 1,
      getset: async () => "old",
      getdel: async () => "deleted",
      keys: async () => ["k1", "k2"],
      scan: async () => ({ cursor: null, keys: ["k1"] }),
      rename: async () => true,
    },
    counter: {
      incr: async () => 1,
      decr: async () => -1,
      cleanupExpired: async () => 0,
    },
    hash: {
      hget: async () => "hval",
      hset: async () => {},
      hmset: async () => {},
      hmget: async () => ["f1", "f2"],
      hgetall: async () => ({ f1: "v1" }),
      hdel: async () => true,
      hexists: async () => true,
      hlen: async () => 3,
      hincrby: async () => 5,
      hkeys: async () => ["f1", "f2"],
      hvals: async () => ["v1", "v2"],
      hstrlen: async () => 4,
      hscan: async () => ({ cursor: null, entries: [["f1", "v1"]] as Array<readonly [string, unknown]> }),
    },
    set: {
      sadd: async () => 2,
      srem: async () => 1,
      smembers: async () => ["a", "b"],
      sismember: async () => true,
      scard: async () => 5,
      sinter: async () => ["a"],
      sunion: async () => ["a", "b"],
      sdiff: async () => ["a"],
      spop: async () => ["a"],
      srandmember: async () => ["b"],
      smove: async () => true,
      sscan: async () => ({ cursor: null, members: ["a"] }),
    },
    sortedSet: {
      zadd: async () => true,
      zscore: async () => 10.5,
      zrange: async () => ["m1", "m2"],
      zrangeByScore: async () => ["m1"],
      zrank: async () => 0,
      zcount: async () => 3,
      zrem: async () => 1,
      zcard: async () => 10,
      zincrby: async () => 15,
      zpopmin: async () => [{ member: "m1", score: 1 }],
      zpopmax: async () => [{ member: "m3", score: 100 }],
      zscan: async () => ({ cursor: null, entries: [{ member: "m1", score: 1 }] }),
    },
    list: {
      lpush: async () => 3,
      rpush: async () => 3,
      lpop: async () => ["val"],
      rpop: async () => ["val"],
      blpop: async () => ({ key: "mylist", value: "val" }),
      brpop: async () => ({ key: "mylist", value: "val" }),
      llen: async () => 5,
      lrange: async () => ["a", "b"],
    },
    pubsub: {
      publish: async () => {},
    },
  };
}

describe("createIoredisAdapter", () => {
  function makeAdapter(): IoredisLikeAdapter {
    return createIoredisAdapter({ client: createMockClient() });
  }

  test("get returns string value", async () => {
    const adapter = makeAdapter();
    const val = await adapter.get("k");
    expect(val).toBe("val");
  });

  test("set with positional args (key, value, EX, seconds)", async () => {
    const adapter = makeAdapter();
    const result = await adapter.set("k", "v", "EX", 60);
    expect(result).toBe("OK");
  });

  test("set with PX and NX positional args", async () => {
    const adapter = makeAdapter();
    const result = await adapter.set("k", "v", "PX", 60000, "NX");
    expect(result).toBe("OK");
  });

  test("del returns count", async () => {
    const adapter = makeAdapter();
    expect(await adapter.del("k1", "k2")).toBe(2);
  });

  test("mget returns string array with nulls", async () => {
    const adapter = makeAdapter();
    const result = await adapter.mget("k1", "k2");
    expect(result).toEqual(["val:k1", "val:k2"]);
  });

  test("mset returns OK", async () => {
    const adapter = makeAdapter();
    expect(await adapter.mset({ a: "1" })).toBe("OK");
  });

  test("scan returns cursor-keyed tuple", async () => {
    const adapter = makeAdapter();
    const [cursor, keys] = await adapter.scan(null);
    expect(cursor).toBeNull();
    expect(keys).toEqual(["k1"]);
  });

  test("hscan returns cursor-entries tuple", async () => {
    const adapter = makeAdapter();
    const [cursor, entries] = await adapter.hscan("h");
    expect(cursor).toBeNull();
    expect(entries).toEqual([["f1", "v1"]]);
  });

  test("sscan returns cursor-members tuple", async () => {
    const adapter = makeAdapter();
    const [cursor, members] = await adapter.sscan("s");
    expect(cursor).toBeNull();
    expect(members).toEqual(["a"]);
  });

  test("zscan returns cursor-entries tuple", async () => {
    const adapter = makeAdapter();
    const [cursor, entries] = await adapter.zscan("z");
    expect(cursor).toBeNull();
    expect(entries).toEqual([{ member: "m1", score: 1 }]);
  });

  test("lrange returns string array", async () => {
    const adapter = makeAdapter();
    const result = await adapter.lrange("l", 0, -1);
    expect(result).toEqual(["a", "b"]);
  });

  test("hvals returns string array", async () => {
    const adapter = makeAdapter();
    const result = await adapter.hvals("h");
    expect(result).toEqual(["v1", "v2"]);
  });

  test("duplicate returns new adapter", () => {
    const adapter = makeAdapter();
    const dup = adapter.duplicate();
    expect(dup).not.toBe(adapter);
  });

  test("on/off return adapter", () => {
    const adapter = makeAdapter();
    const ref = adapter.on("message", () => {});
    expect(ref).toBe(adapter);
    const ref2 = adapter.off("message", () => {});
    expect(ref2).toBe(adapter);
  });

  test("noredis property exposes underlying aliases", () => {
    const adapter = makeAdapter();
    expect(adapter.noredis).toBeDefined();
    expect(typeof adapter.noredis.get).toBe("function");
  });

  test("pipeline returns facade", () => {
    const adapter = makeAdapter();
    const p = adapter.pipeline();
    expect(p).toBeDefined();
    expect(Array.isArray(p.queue)).toBe(true);
  });

  test("type returns string for existing key", async () => {
    const adapter = makeAdapter();
    expect(await adapter.type("k")).toBe("string");
  });
});

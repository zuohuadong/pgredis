import { describe, expect, test } from "bun:test";
import { createRedisJsAdapter, type RedisJsLikeAdapter } from "./redis";

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

describe("createRedisJsAdapter", () => {
  function makeAdapter(): RedisJsLikeAdapter {
    return createRedisJsAdapter({ client: createMockClient() });
  }

  test("get returns string value", async () => {
    const adapter = makeAdapter();
    expect(await adapter.get("k")).toBe("val");
  });

  test("set with options object", async () => {
    const adapter = makeAdapter();
    expect(await adapter.set("k", "v", { EX: 60 })).toBe("OK");
  });

  test("camelCase method names work", async () => {
    const adapter = makeAdapter();
    expect(await adapter.setEx("k", 60, "v")).toBe("OK");
    expect(await adapter.pSetEx("k", 60000, "v")).toBe("OK");
    expect(await adapter.setNx("k", "v")).toBe(1);
    expect(await adapter.getSet("k", "new")).toBe("old");
    expect(await adapter.getDel("k")).toBe("deleted");
    expect(await adapter.mGet("k1", "k2")).toEqual(["val:k1", "val:k2"]);
    expect(await adapter.mSet({ a: "1" })).toBe("OK");
    expect(await adapter.pExpire("k", 60000)).toBe(1);
    expect(await adapter.pTtl("k")).toBe(5000);
  });

  test("hash camelCase methods work", async () => {
    const adapter = makeAdapter();
    expect(await adapter.hGet("h", "f")).toBe("hval");
    expect(await adapter.hSet("h", "f", "v")).toBe(1);
    expect(await adapter.hmSet("h", { f1: "v1" })).toBe("OK");
    expect(await adapter.hDel("h", "f")).toBe(1);
    expect(await adapter.hExists("h", "f")).toBe(1);
    expect(await adapter.hLen("h")).toBe(3);
    expect(await adapter.hIncrBy("h", "f", 2)).toBe(5);
    expect(await adapter.hKeys("h")).toEqual(["f1", "f2"]);
    expect(await adapter.hVals("h")).toEqual(["v1", "v2"]);
    expect(await adapter.hStrLen("h", "f")).toBe(4);
  });

  test("list camelCase methods work", async () => {
    const adapter = makeAdapter();
    expect(await adapter.lPush("l", "a")).toBe(3);
    expect(await adapter.rPush("l", "b")).toBe(3);
    expect(await adapter.lPop("l")).toBe("val");
    expect(await adapter.rPop("l")).toBe("val");
    expect(await adapter.lLen("l")).toBe(5);
    expect(await adapter.lRange("l", 0, -1)).toEqual(["a", "b"]);
  });

  test("set camelCase methods work", async () => {
    const adapter = makeAdapter();
    expect(await adapter.sAdd("s", "a")).toBe(2);
    expect(await adapter.sRem("s", "a")).toBe(1);
    expect(await adapter.sMembers("s")).toEqual(["a", "b"]);
    expect(await adapter.sIsMember("s", "a")).toBe(1);
    expect(await adapter.sCard("s")).toBe(5);
    expect(await adapter.sPop("s")).toEqual(["a"]);
    expect(await adapter.sRandMember("s")).toEqual(["b"]);
    expect(await adapter.sMove("s1", "s2", "a")).toBe(1);
  });

  test("sorted set camelCase methods work", async () => {
    const adapter = makeAdapter();
    expect(await adapter.zAdd("z", 1, "m1")).toBe(1);
    expect(await adapter.zScore("z", "m1")).toBe(10.5);
    expect(await adapter.zRange("z", 0, -1)).toEqual(["m1", "m2"]);
    expect(await adapter.zRevRange("z", 0, -1)).toEqual(["m1", "m2"]);
    expect(await adapter.zRangeByScore("z", 0, 100)).toEqual(["m1"]);
    expect(await adapter.zRank("z", "m1")).toBe(0);
    expect(await adapter.zCount("z", 0, 100)).toBe(3);
    expect(await adapter.zRem("z", "m1")).toBe(1);
    expect(await adapter.zCard("z")).toBe(10);
    expect(await adapter.zIncrBy("z", 5, "m1")).toBe(15);
    expect(await adapter.zPopMin("z")).toEqual([{ member: "m1", score: 1 }]);
    expect(await adapter.zPopMax("z")).toEqual([{ member: "m3", score: 100 }]);
  });

  test("scan returns object with cursor and keys", async () => {
    const adapter = makeAdapter();
    const result = await adapter.scan(null);
    expect(result).toEqual({ cursor: null, keys: ["k1"] });
  });

  test("hScan returns object with cursor and entries", async () => {
    const adapter = makeAdapter();
    const result = await adapter.hScan("h");
    expect(result.cursor).toBeNull();
    expect(result.entries).toEqual([["f1", "v1"]]);
  });

  test("duplicate returns new adapter", () => {
    const adapter = makeAdapter();
    const dup = adapter.duplicate();
    expect(dup).not.toBe(adapter);
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
  });

  test("publish returns 1", async () => {
    const adapter = makeAdapter();
    expect(await adapter.publish("ch", "msg")).toBe(1);
  });
});
